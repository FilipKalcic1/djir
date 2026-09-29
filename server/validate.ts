/**
 * server/validate.ts — small, explicit validators for request fields.
 * Each returns the typed value or throws an HttpError (a 400 naming the
 * field, unless the caller picks the status).
 */

import { scheduleError, SLOT_MINUTES } from "@/lib/schedule";
import { HttpError } from "@/server/http";

/** The largest Postgres `int` (SERIAL ids): bigger ids would overflow the SQL cast. */
export const MAX_ID = 2_147_483_647;
const SLOT_MS = SLOT_MINUTES * 60_000;

export function requireNumber(
  value: unknown,
  name: string,
  { min = -Infinity, max = Infinity } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `${name} must be a number`);
  }
  if (value < min || value > max) {
    throw new HttpError(400, `${name} must be between ${min} and ${max}`);
  }
  return value;
}

export function requireInt(value: unknown, name: string): number {
  const n = requireNumber(value, name, { min: 1, max: MAX_ID });
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} must be an id`);
  return n;
}

export function requireString(
  value: unknown,
  name: string,
  { maxLength = 255 } = {},
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${name} is required`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, `${name} must be at most ${maxLength} characters`);
  }
  return value;
}

export function requireLatLng(lat: unknown, lng: unknown, name: string) {
  return {
    latitude: requireNumber(lat, `${name} latitude`, { min: -90, max: 90 }),
    longitude: requireNumber(lng, `${name} longitude`, {
      min: -180,
      max: 180,
    }),
  };
}

// An ISO-8601 instant WITH an offset. A naive "2026-10-03T23:30" is rejected:
// JavaScript would read it in the server's timezone, Python in none.
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch ms for an optional ISO instant with an explicit offset; null if absent. */
export function optionalInstant(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (
    typeof value !== "string" ||
    !ISO_WITH_OFFSET.test(value) ||
    Number.isNaN(ms)
  ) {
    throw new HttpError(
      400,
      `${name} must be an ISO-8601 time with an offset, e.g. 2026-10-03T21:30:00Z`,
    );
  }
  return ms;
}

/**
 * A scheduled pickup the server will quote and book (K2, K6): inside the lead
 * time and horizon, and on the 15-minute UTC grid the app offers — a crafted
 * request cannot book 08:07:33. Throws `status` with `slot_unavailable` (the
 * app reopens the picker): 400 when quoting, 409 when booking.
 */
export function requireBookableSlot(
  atMs: number,
  nowMs: number,
  status: 400 | 409,
): void {
  const error =
    scheduleError(atMs, nowMs) ??
    (atMs % SLOT_MS === 0
      ? null
      : "Pickup times are every 15 minutes. Please choose another time.");
  if (error) throw new HttpError(status, error, { code: "slot_unavailable" });
}
