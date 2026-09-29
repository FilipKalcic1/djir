/**
 * server/quote.ts — price a trip on the server.
 *
 * Asks the ML serving endpoint (`ML_ENDPOINT_URL`, the FastAPI service in
 * ml-platform/serving) and falls back to the cent-exact heuristic in
 * lib/pricing.ts when it is unset, slow (> ML_TIMEOUT_MS), failing, or returns
 * something that is not a quote. Either way the caller gets the same shape.
 */

import { haversineKm, LatLng } from "@/lib/geo";
import { heuristicQuote, SmartQuote, Weather } from "@/lib/pricing";

export const ML_TIMEOUT_MS = 2500;

export interface TripQuote extends SmartQuote {
  fareCents: number;
}

interface QuoteDeps {
  mlUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

async function askModel(
  pickup: LatLng,
  dropoff: LatLng,
  whenMs: number,
  weather: Weather,
  { mlUrl, fetchImpl = fetch, timeoutMs = ML_TIMEOUT_MS }: QuoteDeps,
): Promise<SmartQuote | null> {
  if (!mlUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${mlUrl.replace(/\/$/, "")}/predict-price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pickup_lat: pickup.latitude,
        pickup_lng: pickup.longitude,
        dropoff_lat: dropoff.latitude,
        dropoff_lng: dropoff.longitude,
        when: new Date(whenMs).toISOString(),
        weather,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`ML endpoint returned ${res.status}; using the heuristic`);
      return null;
    }
    const data = await res.json();
    if (
      !isFinitePositive(data?.total_fare_eur) ||
      !isFinitePositive(data?.eta_minutes) ||
      !isFinitePositive(data?.surge_multiplier)
    ) {
      console.warn(
        "ML endpoint returned an unexpected shape; using the heuristic",
      );
      return null;
    }
    return {
      etaMinutes: data.eta_minutes,
      surgeMultiplier: data.surge_multiplier,
      totalFareEur: data.total_fare_eur,
      tripDistanceKm: data.trip_distance_km,
      source: typeof data.source === "string" ? data.source : "ml-model",
    };
  } catch (error) {
    console.warn("ML endpoint unreachable; using the heuristic:", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function quoteTrip(
  {
    pickup,
    dropoff,
    whenMs,
    weather = "clear",
  }: { pickup: LatLng; dropoff: LatLng; whenMs: number; weather?: Weather },
  deps: QuoteDeps = { mlUrl: process.env.ML_ENDPOINT_URL },
): Promise<TripQuote> {
  const quote =
    (await askModel(pickup, dropoff, whenMs, weather, deps)) ??
    heuristicQuote(
      haversineKm(
        pickup.latitude,
        pickup.longitude,
        dropoff.latitude,
        dropoff.longitude,
      ),
      whenMs,
      weather,
    );
  return { ...quote, fareCents: Math.round(quote.totalFareEur * 100) };
}
