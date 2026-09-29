import { POST } from "@/app/(api)/predict-price+api";
import { verifyQuote } from "@/server/quote-token";

import { QUOTE_SECRET } from "../helpers/api";
import { jsonRequest } from "../helpers/auth";
import { MIN } from "../helpers/rides";

// Monday 5 Oct 2026, 06:00 in Zagreb (04:00Z). The route reads Date.now().
const NOW = Date.parse("2026-10-05T04:00:00Z");
const TRIP = {
  pickup_lat: 45.8,
  pickup_lng: 15.945,
  dropoff_lat: 45.8085,
  dropoff_lng: 15.9775,
};

async function quote(body: unknown) {
  const res = await POST(jsonRequest("/predict-price", body), {});
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  process.env.QUOTE_SIGNING_SECRET = QUOTE_SECRET;
  delete process.env.ML_ENDPOINT_URL;
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

describe("POST /predict-price", () => {
  it("returns a quote and a signed token that books exactly that fare", async () => {
    const { status, body } = await quote(TRIP);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      currency: "EUR",
      source: "heuristic-fallback",
      scheduled_at: null,
    });
    expect(body.fare_cents).toBe(Math.round(body.total_fare_eur * 100));
    expect(body.trip_minutes).toBe(Math.ceil(body.eta_minutes)); // ETAs round up
    const token = await verifyQuote(body.quote_token, QUOTE_SECRET, NOW);
    expect(token).toMatchObject({
      pickup: [45.8, 15.945],
      dropoff: [45.8085, 15.9775],
      scheduledAt: null,
      fareCents: body.fare_cents,
      tripMinutes: body.trip_minutes,
      iat: NOW,
    });
  });

  it("returns server_time, the ISO instant it quoted at, so the app can correct its clock", async () => {
    const { body } = await quote(TRIP);
    expect(body.server_time).toBe("2026-10-05T04:00:00.000Z");
    expect((await verifyQuote(body.quote_token, QUOTE_SECRET, NOW)).iat).toBe(
      Date.parse(body.server_time),
    );
  });

  it("R06: prices a scheduled 08:15 CEST (06:15Z) as the Monday rush hour", async () => {
    const rush = await quote({ ...TRIP, scheduled_at: "2026-10-05T06:15:00Z" });
    const midday = await quote({
      ...TRIP,
      scheduled_at: "2026-10-05T12:00:00Z",
    });
    expect(rush.body.surge_multiplier).toBe(1.4);
    expect(midday.body.surge_multiplier).toBe(1);
    expect(rush.body.total_fare_eur).toBeGreaterThan(
      midday.body.total_fare_eur,
    );
  });

  it("binds the scheduled slot into the token", async () => {
    const { body } = await quote({
      ...TRIP,
      scheduled_at: "2026-10-05T06:15:00+00:00",
    });
    expect(body.scheduled_at).toBe("2026-10-05T06:15:00.000Z");
    expect(
      (await verifyQuote(body.quote_token, QUOTE_SECRET, NOW)).scheduledAt,
    ).toBe(Date.parse("2026-10-05T06:15:00Z"));
  });

  it("uses the ML endpoint when configured, and signs its fare", async () => {
    process.env.ML_ENDPOINT_URL = "http://ml:8000";
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          eta_minutes: 9.7,
          surge_multiplier: 1.6,
          total_fare_eur: 9.74,
          trip_distance_km: 2.69,
          source: "ml-model",
        }),
      ),
    );
    const { body } = await quote(TRIP);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://ml:8000/predict-price",
      expect.anything(),
    );
    expect(body).toMatchObject({
      source: "ml-model",
      fare_cents: 974,
      trip_minutes: 10,
    });
  });

  it.each([
    ["R35: malformed JSON", "{nope", 400],
    ["R27: a missing coordinate", { ...TRIP, pickup_lat: undefined }, 400],
    ["R27: a latitude out of range", { ...TRIP, pickup_lat: 999 }, 400],
    ["R27: a string coordinate", { ...TRIP, dropoff_lng: "15.97" }, 400],
    [
      "R35: a naive time (no offset)",
      { ...TRIP, scheduled_at: "2026-10-05T08:15:00" },
      400,
    ],
    [
      "a slot in the past",
      { ...TRIP, scheduled_at: "2026-10-05T03:00:00Z" },
      400,
    ],
    [
      "a slot more than 7 days ahead",
      { ...TRIP, scheduled_at: "2026-10-13T04:00:00Z" },
      400,
    ],
    [
      "R69: a trip over 60 km (Zagreb → Split)",
      { ...TRIP, dropoff_lat: 43.508, dropoff_lng: 16.44 },
      422,
    ],
  ])("%s → %i", async (_, body, status) => {
    expect((await quote(body)).status).toBe(status);
  });

  it("R69: refuses a trip over 60 km (Zagreb → Split) with a 422 naming the limit", async () => {
    expect(
      await quote({ ...TRIP, dropoff_lat: 43.508, dropoff_lng: 16.44 }),
    ).toEqual({ status: 422, body: { error: "Trips are limited to 60 km" } });
  });

  it("K13: a slot 25 min ahead is inside the 5-min grace → 200", async () => {
    jest.spyOn(Date, "now").mockReturnValue(NOW + 5 * MIN); // 04:05Z
    const res = await quote({ ...TRIP, scheduled_at: "2026-10-05T04:30:00Z" });
    expect(res.status).toBe(200);
    expect(res.body.scheduled_at).toBe("2026-10-05T04:30:00.000Z");
  });

  it("K2: a scheduled_at off the 15-minute grid (06:07:33Z) → 400 slot_unavailable", async () => {
    expect(
      await quote({ ...TRIP, scheduled_at: "2026-10-05T06:07:33Z" }),
    ).toEqual({
      status: 400,
      body: {
        error: "Pickup times are every 15 minutes. Please choose another time.",
        code: "slot_unavailable",
      },
    });
  });

  it("names the problem in the error", async () => {
    const res = await quote({ ...TRIP, scheduled_at: "2026-10-05T03:00:00Z" });
    expect(res.body).toEqual({
      error: "That pickup time is no longer available",
      code: "slot_unavailable",
    });
  });

  it("R35: prices unknown weather (even prototype keys) as clear, never as null", async () => {
    const clear = await quote(TRIP);
    const odd = await quote({ ...TRIP, weather: "toString" });
    expect(odd.body.total_fare_eur).toBe(clear.body.total_fare_eur);
  });

  it.each([
    ["unset", undefined, "Missing environment variable QUOTE_SIGNING_SECRET"],
    [
      "shorter than 32 characters",
      "short",
      "QUOTE_SIGNING_SECRET is shorter than 32 characters",
    ],
  ])(
    "E7: a quote-signing secret that is %s is a 500 whose body names no setting; the log names it",
    async (_, secret, logLine) => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      if (secret === undefined) delete process.env.QUOTE_SIGNING_SECRET;
      else process.env.QUOTE_SIGNING_SECRET = secret;
      expect(await quote(TRIP)).toEqual({
        status: 500,
        body: {
          error: "Something went wrong on our side. Please try again later.",
        },
      });
      expect(log).toHaveBeenCalledWith(logLine);
    },
  );
});
