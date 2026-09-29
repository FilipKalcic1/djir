/**
 * services/quotes.ts — ask the server for a signed trip quote.
 *
 * The app never prices a trip itself: it shows (and later pays) exactly the
 * quote `/(api)/predict-price` signs (ADR-013). The server already falls back
 * to its heuristic when the ML model is slow, so a quote that takes longer than
 * QUOTE_TIMEOUT_MS means the server itself is unreachable — the UI then offers
 * a retry instead of an invented price.
 */

import { LatLng } from "@/lib/geo";
import { fetchAPI } from "@/services/api";
import { setServerTime } from "@/services/clock";
import { TripQuote } from "@/types/type";

export const QUOTE_TIMEOUT_MS = 8000;

interface QuoteResponse {
  quote_token: string;
  fare_cents: number;
  trip_minutes: number;
  surge_multiplier: number;
  source: string;
  scheduled_at: string | null;
  server_time: string;
}

export async function fetchQuote(
  pickup: LatLng,
  dropoff: LatLng,
  scheduledAt: number | null,
  signal?: AbortSignal,
): Promise<TripQuote> {
  // AbortSignal.timeout does not exist on Hermes (RN 0.74): combine by hand.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort);
  if (signal?.aborted) controller.abort(); // "abort" never fires again
  try {
    const res = await fetchAPI<QuoteResponse>("/(api)/predict-price", {
      method: "POST",
      body: JSON.stringify({
        pickup_lat: pickup.latitude,
        pickup_lng: pickup.longitude,
        dropoff_lat: dropoff.latitude,
        dropoff_lng: dropoff.longitude,
        ...(scheduledAt === null
          ? {}
          : { scheduled_at: new Date(scheduledAt).toISOString() }),
      }),
      signal: controller.signal,
    });
    setServerTime(res.server_time);
    return {
      token: res.quote_token,
      fareCents: res.fare_cents,
      tripMinutes: res.trip_minutes,
      surgeMultiplier: res.surge_multiplier,
      source: res.source,
      scheduledAt:
        res.scheduled_at === null ? null : Date.parse(res.scheduled_at),
      issuedAtMs: Date.now(),
    };
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(
        "Couldn't get prices. Check your connection and try again.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}
