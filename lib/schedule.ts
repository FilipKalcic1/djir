/**
 * lib/schedule.ts — when a ride can be scheduled (ADR-012).
 *
 * Slots are instants on a 15-minute grid, labelled on the Zagreb wall clock.
 * Zagreb's UTC offset is a whole number of hours, so a UTC-aligned grid lands
 * on :00/:15/:30/:45 locally, and DST days simply have 92 or 100 slots — the
 * repeated autumn hour is labelled with its zone ("02:15 CEST" / "02:15 CET"),
 * here and on every surface after the picker (K12).
 * The client offers only valid slots; the server re-checks with a small grace.
 */

import {
  formatPickupTime,
  formatZagrebDate,
  nextZagrebDayKey,
  zagrebDayKey,
} from "@/lib/zagreb-time";

/** Pickup slots are 15 minutes apart (K2). */
export const SLOT_MINUTES = 15;
/** The earliest slot is at least 30 minutes away (K1). */
export const LEAD_MINUTES = 30;
/** Rides can be scheduled up to 7 days ahead (K3). */
export const HORIZON_HOURS = 168;
/** The server accepts a slot up to this much "late" (slow hands, slow network). */
export const SERVER_GRACE_MINUTES = 5;

const MS_PER_MINUTE = 60_000;
const SLOT_MS = SLOT_MINUTES * MS_PER_MINUTE;
const HORIZON_MS = HORIZON_HOURS * 60 * MS_PER_MINUTE;

/** One bookable pickup instant and its label ("08:30", "02:15 CEST"). */
export interface Slot {
  atMs: number;
  label: string;
}

/** The slots of one Zagreb calendar day, labelled "Today", "Tomorrow" or by date. */
export interface ScheduleDay {
  key: string;
  label: string;
  slots: Slot[];
}

/** The first bookable slot: the first grid instant ≥ now + 30 min. */
export function earliestSlot(nowMs: number): number {
  return Math.ceil((nowMs + LEAD_MINUTES * MS_PER_MINUTE) / SLOT_MS) * SLOT_MS;
}

/** "Today", "Tomorrow" or "Sat 3 Oct", on Zagreb calendar days. */
export function dayLabel(atMs: number, nowMs: number): string {
  const key = zagrebDayKey(atMs);
  if (key === zagrebDayKey(nowMs)) return "Today";
  if (key === nextZagrebDayKey(nowMs)) return "Tomorrow";
  return formatZagrebDate(atMs);
}

/** Every bookable slot from now, grouped by Zagreb day. */
export function scheduleDays(nowMs: number): ScheduleDay[] {
  const days: ScheduleDay[] = [];
  const end = nowMs + HORIZON_MS;
  for (let atMs = earliestSlot(nowMs); atMs < end; atMs += SLOT_MS) {
    const key = zagrebDayKey(atMs);
    if (days.length === 0 || days[days.length - 1].key !== key) {
      days.push({ key, label: dayLabel(atMs, nowMs), slots: [] });
    }
    days[days.length - 1].slots.push({ atMs, label: formatPickupTime(atMs) });
  }
  return days;
}

/** A slot that went stale while the picker was open moves to the earliest valid one. */
export function resnapSlot(atMs: number, nowMs: number): number {
  return Math.max(atMs, earliestSlot(nowMs));
}

/** Server-side check of a requested pickup time; null when it is acceptable. */
export function scheduleError(atMs: number, nowMs: number): string | null {
  const earliestMs =
    nowMs + (LEAD_MINUTES - SERVER_GRACE_MINUTES) * MS_PER_MINUTE;
  if (atMs < earliestMs) return "That pickup time is no longer available";
  if (atMs >= nowMs + HORIZON_MS + SLOT_MS) {
    return "Rides can be scheduled up to 7 days ahead";
  }
  return null;
}

/**
 * "Now", "Today · 23:30", "Tomorrow · 08:00" or "Sat 3 Oct · 23:30" ("Sun 25
 * Oct · 02:15 CET" in the repeated autumn hour, K12).
 */
export function describePickup(
  scheduledAt: number | null,
  nowMs: number,
): string {
  if (scheduledAt === null) return "Now";
  return `${dayLabel(scheduledAt, nowMs)} · ${formatPickupTime(scheduledAt)}`;
}

/** "today at 08:00", "tomorrow at 08:00" or "on Sat 3 Oct at 08:00" (zone as in K12). */
export function pickupSentence(atMs: number, nowMs: number): string {
  const day = dayLabel(atMs, nowMs);
  const when =
    day === "Today" || day === "Tomorrow" ? day.toLowerCase() : `on ${day}`;
  return `${when} at ${formatPickupTime(atMs)}`;
}

/** How long a chosen slot may have gone stale before we stop guessing (K4/K5). */
export const RESNAP_WINDOW_MINUTES = 15;

/** What checkSlot decided: keep the pickup time, move it (K4), or drop it (K5). */
export type SlotCheck =
  | { status: "ok"; atMs: number | null }
  | { status: "moved"; atMs: number; notice: string }
  | { status: "expired"; notice: string };

/**
 * Re-check the chosen pickup time just before quoting. A slot that went stale
 * a moment ago moves to the next valid one (with a notice); one that went
 * stale long ago is dropped, and the rider picks again.
 */
export function checkSlot(atMs: number | null, nowMs: number): SlotCheck {
  if (atMs === null) return { status: "ok", atMs: null };
  const earliest = earliestSlot(nowMs);
  if (atMs >= earliest) return { status: "ok", atMs };
  // Stale since it fell inside the 30-minute lead. (Not `earliest - atMs`: on
  // the 15-minute grid that gap is never under 15 minutes.)
  const staleMs = nowMs + LEAD_MINUTES * MS_PER_MINUTE - atMs;
  if (staleMs < RESNAP_WINDOW_MINUTES * MS_PER_MINUTE) {
    return {
      status: "moved",
      atMs: earliest,
      notice: `That time is now too soon — moved to ${formatPickupTime(earliest)}`,
    };
  }
  return {
    status: "expired",
    notice: "That pickup time is no longer available — choose a new time",
  };
}
