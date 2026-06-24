import { haversineKm, heuristicQuote } from "@/lib/pricing";

/**
 * POST /(api)/predict-price
 *
 * Server route that quotes a ride's ETA + dynamic-surge fare. It forwards the
 * request to the Djir ML serving endpoint (FastAPI / Databricks Model Serving —
 * see `ml-platform/`) when `ML_ENDPOINT_URL` is configured, and otherwise falls
 * back to the deterministic heuristic in `lib/pricing.ts`. Either way the mobile
 * client gets the same response shape, so the ride-booking flow never blocks on
 * the ML backend being up.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const {
    pickup_lat,
    pickup_lng,
    dropoff_lat,
    dropoff_lng,
    when,
    weather = "clear",
  } = body ?? {};

  if (
    [pickup_lat, pickup_lng, dropoff_lat, dropoff_lng].some(
      (v) => typeof v !== "number",
    )
  ) {
    return new Response(
      JSON.stringify({ error: "pickup_lat, pickup_lng, dropoff_lat, dropoff_lng are required numbers" }),
      { status: 400 },
    );
  }

  // ── Primary path: the trained ML models behind the serving endpoint ────────
  const mlUrl = process.env.ML_ENDPOINT_URL;
  if (mlUrl) {
    try {
      const res = await fetch(`${mlUrl.replace(/\/$/, "")}/predict-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup_lat,
          pickup_lng,
          dropoff_lat,
          dropoff_lng,
          when,
          weather,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return Response.json(data);
      }
      console.warn("ML endpoint returned", res.status, "- using heuristic");
    } catch (e) {
      console.warn("ML endpoint unreachable - using heuristic:", e);
    }
  }

  // ── Fallback path: deterministic heuristic (mirrors djir_ml/pricing.py) ─────
  const distanceKm = haversineKm(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng);
  const quote = heuristicQuote(distanceKm, when ? new Date(when) : new Date(), weather);

  return Response.json({
    eta_minutes: quote.etaMinutes,
    surge_multiplier: quote.surgeMultiplier,
    total_fare_eur: quote.totalFareEur,
    trip_distance_km: Math.round(distanceKm * 100) / 100,
    currency: "EUR",
    source: quote.source,
  });
}
