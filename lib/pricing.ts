/**
 * lib/pricing.ts — smart fare/ETA for the client.
 *
 * The mobile app asks its own `/(api)/predict-price` route for a quote, which in
 * turn calls the Djir ML serving endpoint (the XGBoost ETA + surge models trained
 * on the Databricks lakehouse — see `ml-platform/`). If the endpoint is
 * unreachable, this file's heuristic takes over so the user always sees a price.
 *
 * The heuristic here is a deliberate, line-for-line port of
 * `ml-platform/djir_ml/pricing.py`. If you change a constant or formula there,
 * change it here too — they are meant to agree to the cent.
 */

import { fetchAPI } from "@/lib/fetch";
import { MarkerData } from "@/types/type";

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
// Client-only constant (the driver→rider approach leg). This is NOT part of the
// physics mirrored from djir_ml; the backend prices the trip, the app adds pickup.
const PICKUP_LEG_SPEED_KMH = 25.0;

const WEATHER_SPEED_FACTOR: Record<string, number> = {
  clear: 1.0,
  rain: 0.82,
  fog: 0.78,
  snow: 0.62,
};

export interface SmartQuote {
  etaMinutes: number;
  surgeMultiplier: number;
  totalFareEur: number;
  source: string;
}

/** Great-circle distance in km (mirror djir_ml/geo.py). */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLmb = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLmb / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// JS getDay(): Sun=0..Sat=6. Python weekday(): Mon=0..Sun=6. Convert so the
// rush-hour / weekend logic matches what the models were trained on.
const pyWeekday = (d: Date) => (d.getDay() + 6) % 7;

const isWeekend = (dow: number) => (dow >= 5 ? 1 : 0);

const isRushHour = (hour: number, dow: number) => {
  if (isWeekend(dow)) return 0;
  const morning = hour >= 7 && hour <= 9;
  const evening = hour >= 16 && hour <= 19;
  return morning || evening ? 1 : 0;
};

function trafficDensity(hour: number, dow: number): number {
  const weekend = isWeekend(dow);
  if (isRushHour(hour, dow)) return 0.92;
  if (hour >= 10 && hour <= 15) return weekend ? 0.4 : 0.45;
  if (hour >= 20 && hour <= 23) return weekend ? 0.55 : 0.45;
  if (hour >= 0 && hour <= 5) return 0.12;
  return 0.35;
}

function estimateDurationMin(
  distanceKm: number,
  hour: number,
  dow: number,
  weather: string,
): number {
  const td = trafficDensity(hour, dow);
  let speed = BASE_SPEED_KMH - (BASE_SPEED_KMH - RUSH_SPEED_KMH) * td;
  speed *= WEATHER_SPEED_FACTOR[weather] ?? 1.0;
  speed = Math.max(6.0, speed);
  return (distanceKm / speed) * 60.0 + PICKUP_OVERHEAD_MIN;
}

function heuristicSurge(hour: number, dow: number, weather: string): number {
  let surge = 1.0;
  if (isRushHour(hour, dow)) surge += 0.4;
  if (isWeekend(dow) && (hour >= 21 || hour <= 3)) surge += 0.3;
  surge += ({ clear: 0, fog: 0.1, rain: 0.2, snow: 0.4 } as Record<string, number>)[weather] ?? 0;
  surge = Math.min(SURGE_MAX, Math.max(SURGE_MIN, surge));
  return Math.round(surge * 20) / 20;
}

function baseFare(distanceKm: number, durationMin: number): number {
  return BASE_FARE_EUR + PER_KM_EUR * distanceKm + PER_MIN_EUR * durationMin;
}

function totalFare(base: number, surge: number): number {
  const s = Math.min(SURGE_MAX, Math.max(SURGE_MIN, surge));
  return Math.round(Math.max(MIN_FARE_EUR, base * s) * 100) / 100;
}

/** Model-free quote — used when the ML endpoint is unreachable. */
export function heuristicQuote(
  distanceKm: number,
  when: Date,
  weather: string = "clear",
): SmartQuote {
  const hour = when.getHours();
  const dow = pyWeekday(when);
  const eta = estimateDurationMin(distanceKm, hour, dow, weather);
  const surge = heuristicSurge(hour, dow, weather);
  return {
    etaMinutes: Math.round(eta * 10) / 10,
    surgeMultiplier: surge,
    totalFareEur: totalFare(baseFare(distanceKm, eta), surge),
    source: "heuristic-fallback",
  };
}

/**
 * Ask the app's `/(api)/predict-price` route for an ML quote, falling back to
 * the local heuristic on any error so the UI never blocks.
 */
export async function fetchSmartFare(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  when: Date = new Date(),
  weather: string = "clear",
): Promise<SmartQuote> {
  const distanceKm = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  try {
    const res = await fetchAPI("/(api)/predict-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,
        when: when.toISOString(),
        weather,
      }),
    });
    if (res && typeof res.total_fare_eur === "number") {
      return {
        etaMinutes: res.eta_minutes,
        surgeMultiplier: res.surge_multiplier,
        totalFareEur: res.total_fare_eur,
        source: res.source ?? "ml-model",
      };
    }
  } catch (e) {
    console.warn("Smart fare endpoint unavailable, using heuristic:", e);
  }
  return heuristicQuote(distanceKm, when, weather);
}

/**
 * Set every driver's `time` and `price` from a single smart quote for the trip
 * (rider → destination), adding each driver's pickup-leg time. Replaces the old
 * Google-Directions pricing path and works with zero external API keys.
 */
export async function calculateSmartFares({
  markers,
  userLatitude,
  userLongitude,
  destinationLatitude,
  destinationLongitude,
  when = new Date(),
  weather = "clear",
}: {
  markers: MarkerData[];
  userLatitude: number | null;
  userLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  when?: Date;
  weather?: string;
}): Promise<MarkerData[]> {
  if (
    !userLatitude ||
    !userLongitude ||
    !destinationLatitude ||
    !destinationLongitude
  ) {
    return markers;
  }

  const quote = await fetchSmartFare(
    userLatitude,
    userLongitude,
    destinationLatitude,
    destinationLongitude,
    when,
    weather,
  );

  return markers.map((marker) => {
    const pickupKm = haversineKm(
      marker.latitude,
      marker.longitude,
      userLatitude,
      userLongitude,
    );
    const pickupMin = (pickupKm / PICKUP_LEG_SPEED_KMH) * 60;
    return {
      ...marker,
      time: Math.round(quote.etaMinutes + pickupMin),
      price: quote.totalFareEur.toFixed(2),
    };
  });
}
