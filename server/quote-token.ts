/**
 * server/quote-token.ts — "you pay exactly the price you saw" (ADR-013).
 *
 * `/predict-price` signs every quote it returns (HMAC-SHA256 with
 * `QUOTE_SIGNING_SECRET`); `/ride/book` charges the signed `fare_cents` of a
 * fresh token instead of re-quoting. The client can read a token but cannot
 * forge or alter one, and a quote cannot be replayed after `QUOTE_TTL_MS`.
 */

import { HttpError, SERVER_FAULT } from "@/server/http";

export const QUOTE_TTL_MS = 10 * 60_000;
const CLOCK_TOLERANCE_MS = 5_000;

export interface QuotePayload {
  v: 1;
  pickup: [number, number];
  dropoff: [number, number];
  /** Epoch ms of the scheduled pickup, or null for a ride now. */
  scheduledAt: number | null;
  fareCents: number;
  tripMinutes: number;
  source: string;
  /** Epoch ms the quote was issued. */
  iat: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    console.error("QUOTE_SIGNING_SECRET is shorter than 32 characters");
    throw new HttpError(500, SERVER_FAULT); // E7
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signQuote(
  payload: QuotePayload,
  secret: string,
): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

const invalid = () => new HttpError(400, "Invalid price quote");

/** The payload of a genuine, unexpired token; 400 if forged, 409 if stale. */
export async function verifyQuote(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): Promise<QuotePayload> {
  if (typeof token !== "string") throw invalid();
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) throw invalid();

  let genuine: boolean;
  try {
    genuine = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(body),
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw invalid();
  }
  if (!genuine) throw invalid();

  const payload = JSON.parse(
    new TextDecoder().decode(fromBase64Url(body)),
  ) as QuotePayload;
  if (payload.v !== 1) throw invalid();
  if (
    nowMs - payload.iat > QUOTE_TTL_MS ||
    payload.iat - nowMs > CLOCK_TOLERANCE_MS
  ) {
    throw new HttpError(409, "Price expired — refreshing", {
      code: "quote_expired",
    });
  }
  return payload;
}
