/**
 * lib/pricing.ts — smart fare/ETA for the app.
 *
 * The app asks its own `/(api)/predict-price` route for a quote. On the server,
 * that route calls the Djir ML serving endpoint (XGBoost ETA + surge models,
 * see `ml-platform/`) when one is configured, and otherwise prices the trip
 * with `heuristicQuote` below. The app itself never computes a price: it shows
 * and pays the signed quote the server returns (ADR-013).
 *
 * `heuristicQuote` is a port of `djir_ml.predict.heuristic_quote(
 * djir_ml.features.request_features(...))` and agrees with it to the cent,
 * including Python's rounding and the Zagreb wall clock. That is not a claim
 * but a test: __tests__/lib/pricing.test.ts replays golden vectors exported by
 * `ml-platform/scripts/export_parity_fixtures.py`. Change the Python side,
 * re-export, and the test tells you what to change here.
 */

import { distanceKm, LatLng } from "@/lib/geo";
import { zagrebClock } from "@/lib/zagreb-time";

// ── Pricing constants (mirror djir_ml/config.py) ──────────────────────────────
const BASE_FARE_EUR = 2.0;
const PER_KM_EUR = 0.8;
const PER_MIN_EUR = 0.2;
const MIN_FARE_EUR = 3.5;
const BASE_SPEED_KMH = 32.0;
const RUSH_SPEED_KMH = 17.0;
const PICKUP_OVERHEAD_MIN = 1.5;
const SURGE_MIN = 1.0;
const SURGE_MAX = 3.0;

// ── App-only constants (not part of the mirrored physics) ────────────────────
/** Average speed of a driver's approach leg to the rider. */
export const PICKUP_LEG_SPEED_KMH = 25.0;
/** Longest trip we quote or charge (R69: stops a €332 "ride" to Split). */
export const MAX_TRIP_KM = 60;

/** The weather the models know (djir_ml/config.py). */
export const WEATHER_CONDITIONS = ["clear", "rain", "fog", "snow"] as const;
/** One of WEATHER_CONDITIONS. */
export type Weather = (typeof WEATHER_CONDITIONS)[number];

const WEATHER_SPEED_FACTOR: Record<Weather, number> = {
  clear: 1.0,
  rain: 0.82,
  fog: 0.78,
  snow: 0.62,
};
const WEATHER_SURGE: Record<Weather, number> = {
  clear: 0,
  fog: 0.1,
  rain: 0.2,
  snow: 0.4,
};

/** Unknown weather is priced as clear, exactly like features.py. */
export function toWeather(value: unknown): Weather {
  return WEATHER_CONDITIONS.includes(value as Weather)
    ? (value as Weather)
    : "clear";
}

/** A priced trip: the heuristic's answer, shaped like the ML endpoint's. */
export interface SmartQuote {
  etaMinutes: number;
  surgeMultiplier: number;
  totalFareEur: number;
  tripDistanceKm: number;
  source: string;
}

/**
 * Python's `round(x, digits)`: rounds the exact binary value of `x`, and
 * breaks exact ties to the even digit (16.125 → 16.12, where
 * `Math.round(x * 100) / 100` gives 16.13).
 */
export function pyRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  // toFixed(20) exposes the exact decimal expansion far enough to see a tie.
  const [whole, frac = ""] = abs.toFixed(20).split(".");
  const kept = frac.slice(0, digits);
  const rest = frac.slice(digits);
  let rounded = Number(abs.toFixed(digits)); // exact value, ties rounded up
  if (rest[0] === "5" && /^0*$/.test(rest.slice(1))) {
    const lastDigit = Number((whole + kept).slice(-1));
    if (lastDigit % 2 === 0) {
      rounded = Number(digits > 0 ? `${whole}.${kept}` : whole);
    }
  }
  return sign * rounded;
}

// Python weekday: Monday=0 … Sunday=6 (what the models were trained on).
const isWeekend = (dayOfWeek: number) => (dayOfWeek >= 5 ? 1 : 0);

const isRushHour = (hour: number, dayOfWeek: number) => {
  if (isWeekend(dayOfWeek)) return 0;
  const morning = hour >= 7 && hour <= 9;
  const evening = hour >= 16 && hour <= 19;
  return morning || evening ? 1 : 0;
};

function trafficDensity(hour: number, dayOfWeek: number): number {
  const weekend = isWeekend(dayOfWeek);
  if (isRushHour(hour, dayOfWeek)) return 0.92;
  if (hour >= 10 && hour <= 15) return weekend ? 0.4 : 0.45;
  if (hour >= 20 && hour <= 23) return weekend ? 0.55 : 0.45;
  if (hour >= 0 && hour <= 5) return 0.12;
  return 0.35;
}

function estimateDurationMin(
  distanceKm: number,
  hour: number,
  dayOfWeek: number,
  weather: Weather,
): number {
  const density = trafficDensity(hour, dayOfWeek);
  let speed = BASE_SPEED_KMH - (BASE_SPEED_KMH - RUSH_SPEED_KMH) * density;
  speed *= WEATHER_SPEED_FACTOR[weather];
  speed = Math.max(6.0, speed);
  return (distanceKm / speed) * 60.0 + PICKUP_OVERHEAD_MIN;
}

function heuristicSurge(hour: number, dayOfWeek: number, weather: Weather) {
  let surge = 1.0;
  if (isRushHour(hour, dayOfWeek)) surge += 0.4;
  if (isWeekend(dayOfWeek) && (hour >= 21 || hour <= 3)) surge += 0.3;
  surge += WEATHER_SURGE[weather];
  surge = Math.min(SURGE_MAX, Math.max(SURGE_MIN, surge));
  return pyRound(surge * 20) / 20;
}

function baseFare(distanceKm: number, durationMin: number): number {
  return BASE_FARE_EUR + PER_KM_EUR * distanceKm + PER_MIN_EUR * durationMin;
}

function totalFare(base: number, surge: number): number {
  const s = Math.min(SURGE_MAX, Math.max(SURGE_MIN, surge));
  return pyRound(Math.max(MIN_FARE_EUR, base * s), 2);
}

/**
 * Model-free quote for a trip of `distanceKm` requested at instant `when`.
 * Hour and weekday are read on the Zagreb wall clock, never the device's.
 */
export function heuristicQuote(
  distanceKm: number,
  when: Date | number,
  weather: Weather = "clear",
): SmartQuote {
  const km = pyRound(distanceKm, 3); // features.py rounds before pricing
  const { hour, dayOfWeek } = zagrebClock(when);
  const eta = Math.max(1.5, estimateDurationMin(km, hour, dayOfWeek, weather));
  const surge = heuristicSurge(hour, dayOfWeek, weather);
  return {
    etaMinutes: pyRound(eta, 1),
    surgeMultiplier: pyRound(surge, 2),
    totalFareEur: totalFare(baseFare(km, eta), surge),
    tripDistanceKm: pyRound(km, 2),
    source: "heuristic-fallback",
  };
}

/**
 * Minutes for a driver at `from` to reach the rider at `to`, at least 1.
 * ETAs always round UP: never promise a car sooner than it can arrive.
 */
export function pickupMinutesFor(from: LatLng, to: LatLng): number {
  const minutes = (distanceKm(from, to) / PICKUP_LEG_SPEED_KMH) * 60;
  return Math.max(1, Math.ceil(minutes));
}
