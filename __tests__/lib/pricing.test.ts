import { haversineKm } from "@/lib/geo";
import {
  heuristicQuote,
  pickupMinutesFor,
  pyRound,
  toWeather,
  Weather,
} from "@/lib/pricing";

import fixture from "../fixtures/pricing-parity.json";

describe("heuristicQuote ↔ djir_ml parity (golden vectors from Python)", () => {
  it.each(fixture.trips)(
    "R25: $when · $weather → €$total_fare_eur",
    ({ pickup, dropoff, when, weather, ...expected }) => {
      const km = haversineKm(pickup[0], pickup[1], dropoff[0], dropoff[1]);
      const quote = heuristicQuote(km, new Date(when), weather as Weather);

      expect(quote.totalFareEur).toBe(expected.total_fare_eur);
      expect(quote.etaMinutes).toBe(expected.eta_minutes);
      expect(quote.surgeMultiplier).toBe(expected.surge_multiplier);
      expect(pyRound(km, 3)).toBe(expected.trip_distance_km);
    },
  );

  it("R25: covers both DST switches and all four weathers", () => {
    const hours = new Set(fixture.trips.map((t) => t.when.slice(0, 13)));
    expect(hours).toContain("2026-03-29T00");
    expect(hours).toContain("2026-10-25T01");
    expect(new Set(fixture.trips.map((t) => t.weather)).size).toBe(4);
  });
});

describe("pyRound", () => {
  it.each(fixture.rounding)(
    "R25: round($value, $digits) = $rounded, like Python",
    ({ value, digits, rounded }) => {
      expect(pyRound(value, digits)).toBe(rounded);
    },
  );

  it("R25: breaks exact ties to even where Math.round would round up", () => {
    expect(pyRound(16.125, 2)).toBe(16.12);
    expect(Math.round(16.125 * 100) / 100).toBe(16.13);
  });

  it("is symmetric for negatives and passes non-finite values through", () => {
    expect(pyRound(-2.5)).toBe(-2);
    expect(pyRound(-1.26, 1)).toBe(-1.3);
    expect(pyRound(NaN)).toBeNaN();
    expect(pyRound(Infinity)).toBe(Infinity);
  });

  it("returns huge values (≥ 1e21, which toFixed writes in exponent form) unchanged", () => {
    expect(pyRound(1e21, 2)).toBe(1e21);
    expect(pyRound(-2.5e22)).toBe(-2.5e22);
  });
});

describe("heuristicQuote uses the Zagreb wall clock", () => {
  const KM = 5;

  it("R06: prices 06:15Z in June as the 08:15 rush hour in Zagreb", () => {
    const rush = heuristicQuote(KM, new Date("2025-06-03T06:15:00Z"));
    expect(rush.surgeMultiplier).toBe(1.4);
  });

  it("R06: prices 06:15Z in January as 07:15 (CET), also rush hour", () => {
    expect(
      heuristicQuote(KM, new Date("2025-01-07T06:15:00Z")).surgeMultiplier,
    ).toBe(1.4);
  });

  it("R06: treats Friday 23:30Z in summer as Saturday 01:30 (weekend night)", () => {
    expect(
      heuristicQuote(KM, new Date("2025-06-06T23:30:00Z")).surgeMultiplier,
    ).toBe(1.3);
  });

  it("accepts epoch milliseconds as well as Dates", () => {
    const at = Date.UTC(2025, 5, 3, 6, 15);
    expect(heuristicQuote(KM, at)).toEqual(heuristicQuote(KM, new Date(at)));
  });
});

describe("toWeather", () => {
  it.each(["clear", "rain", "fog", "snow"])("R35: keeps %s", (w) => {
    expect(toWeather(w)).toBe(w);
  });

  it.each(["Rain", "storm", "toString", "__proto__", undefined, 42])(
    "R35: maps %p to clear, like features.py",
    (w) => {
      expect(toWeather(w)).toBe("clear");
    },
  );
});

describe("pickupMinutesFor", () => {
  const rider = { latitude: 45.8, longitude: 15.97 };

  it("is at least one minute, even for a driver on the spot", () => {
    expect(pickupMinutesFor(rider, rider)).toBe(1);
  });

  it("drives the approach leg at 25 km/h and rounds up", () => {
    // 2.4 km north → 5.76 minutes at 25 km/h → "6 min"
    const driver = { latitude: 45.8 + 2.4 / 111.195, longitude: 15.97 };
    expect(pickupMinutesFor(driver, rider)).toBe(6);
  });
});
