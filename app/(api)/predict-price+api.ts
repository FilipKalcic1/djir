import { distanceKm } from "@/lib/geo";
import { MAX_TRIP_KM, toWeather } from "@/lib/pricing";
import { HttpError, readJson, requireEnv, route } from "@/server/http";
import { quoteTrip } from "@/server/quote";
import { signQuote } from "@/server/quote-token";
import {
  optionalInstant,
  requireBookableSlot,
  requireLatLng,
} from "@/server/validate";

/**
 * POST /(api)/predict-price — public.
 *
 * Quotes a trip (ML model, or the heuristic when the model is unavailable) for
 * now or for a scheduled pickup, and returns a signed `quote_token` that
 * /ride/book charges exactly (ADR-013). `scheduled_at` must carry an offset
 * and be a slot on the 15-minute grid.
 */
export const POST = route(async (request) => {
  const body = await readJson(request);
  const pickup = requireLatLng(body.pickup_lat, body.pickup_lng, "pickup");
  const dropoff = requireLatLng(body.dropoff_lat, body.dropoff_lng, "dropoff");
  if (distanceKm(pickup, dropoff) > MAX_TRIP_KM) {
    throw new HttpError(422, `Trips are limited to ${MAX_TRIP_KM} km`);
  }

  const nowMs = Date.now();
  const scheduledAt = optionalInstant(body.scheduled_at, "scheduled_at");
  if (scheduledAt !== null) requireBookableSlot(scheduledAt, nowMs, 400); // K2, K6

  const quote = await quoteTrip({
    pickup,
    dropoff,
    whenMs: scheduledAt ?? nowMs,
    weather: toWeather(body.weather),
  });
  const tripMinutes = Math.max(1, Math.ceil(quote.etaMinutes)); // ETAs round up
  const quoteToken = await signQuote(
    {
      v: 1,
      pickup: [pickup.latitude, pickup.longitude],
      dropoff: [dropoff.latitude, dropoff.longitude],
      scheduledAt,
      fareCents: quote.fareCents,
      tripMinutes,
      source: quote.source,
      iat: nowMs,
    },
    requireEnv(process.env.QUOTE_SIGNING_SECRET, "QUOTE_SIGNING_SECRET"),
  );

  return {
    eta_minutes: quote.etaMinutes,
    trip_minutes: tripMinutes,
    surge_multiplier: quote.surgeMultiplier,
    total_fare_eur: quote.totalFareEur,
    fare_cents: quote.fareCents,
    trip_distance_km: quote.tripDistanceKm,
    currency: "EUR",
    source: quote.source,
    scheduled_at:
      scheduledAt === null ? null : new Date(scheduledAt).toISOString(),
    quote_token: quoteToken,
    // Lets the app correct its clock before it offers pickup slots.
    server_time: new Date(nowMs).toISOString(),
  };
});
