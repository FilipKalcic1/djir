import {
  HttpError,
  readJson,
  requireEnv,
  route,
  SERVER_FAULT,
  within,
} from "@/server/http";
import { ML_TIMEOUT_MS, quoteTrip } from "@/server/quote";
import {
  QUOTE_TTL_MS,
  QuotePayload,
  signQuote,
  verifyQuote,
} from "@/server/quote-token";
import {
  optionalInstant,
  requireBookableSlot,
  requireInt,
  requireLatLng,
  requireNumber,
  requireString,
} from "@/server/validate";

import { jsonRequest } from "../helpers/auth";

const SECRET = "test-secret-that-is-at-least-32-chars!";
const NOW = Date.UTC(2026, 9, 3, 19, 0);
const payload: QuotePayload = {
  v: 1,
  pickup: [45.8, 15.945],
  dropoff: [45.8085, 15.9775],
  scheduledAt: null,
  fareCents: 974,
  tripMinutes: 12,
  source: "ml-model",
  iat: NOW,
};

// Restored even when a test fails half-way: a silenced console.error must
// never reach the next test.
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** E7: the only 500 a rider can read. */
const FAULT_500 = { name: "HttpError", status: 500, message: SERVER_FAULT };

async function rejectsWith(
  promise: Promise<unknown>,
  status: number,
  message?: RegExp,
) {
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  await expect(promise).rejects.toMatchObject({
    status,
    ...(message ? { message: expect.stringMatching(message) } : {}),
  });
}

describe("quote tokens (ADR-013)", () => {
  it("round-trips a signed quote", async () => {
    const token = await signQuote(payload, SECRET);
    await expect(verifyQuote(token, SECRET, NOW + 60_000)).resolves.toEqual(
      payload,
    );
  });

  it("rejects a token whose fare was edited", async () => {
    const [body, sig] = (await signQuote(payload, SECRET)).split(".");
    const cheaper = Buffer.from(
      JSON.stringify({ ...payload, fareCents: 50 }),
    ).toString("base64url");
    expect(cheaper).not.toBe(body);
    await rejectsWith(verifyQuote(`${cheaper}.${sig}`, SECRET, NOW), 400);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signQuote(
      payload,
      "another-secret-that-is-32-chars-long!",
    );
    await rejectsWith(verifyQuote(token, SECRET, NOW), 400);
  });

  it("expires after 10 minutes with a 409 the app can react to", async () => {
    const token = await signQuote(payload, SECRET);
    await expect(
      verifyQuote(token, SECRET, NOW + QUOTE_TTL_MS),
    ).resolves.toBeTruthy();
    await rejectsWith(
      verifyQuote(token, SECRET, NOW + QUOTE_TTL_MS + 1),
      409,
      /expired/,
    );
  });

  it("rejects a token issued in the future", async () => {
    const token = await signQuote({ ...payload, iat: NOW + 60_000 }, SECRET);
    await rejectsWith(verifyQuote(token, SECRET, NOW), 409);
  });

  it.each([[undefined], [42], ["abc"], ["a.b.c"], ["!!.@@"]])(
    "rejects %p",
    async (token) => {
      await rejectsWith(verifyQuote(token, SECRET, NOW), 400);
    },
  );

  it("rejects an unknown payload version", async () => {
    const token = await signQuote({ ...payload, v: 2 as 1 }, SECRET);
    await rejectsWith(verifyQuote(token, SECRET, NOW), 400);
  });

  it("E7: a weak signing secret is a logged 500 that names no setting", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(signQuote(payload, "short")).rejects.toMatchObject(FAULT_500);
    await expect(verifyQuote("a.b", "short", NOW)).rejects.toMatchObject(
      FAULT_500,
    );
    expect(log).toHaveBeenCalledWith(
      "QUOTE_SIGNING_SECRET is shorter than 32 characters",
    );
  });
});

describe("route()", () => {
  const call = (handler: () => Promise<unknown>) =>
    route(handler)(jsonRequest("/x"), {});

  it("sends a returned object as 200 JSON", async () => {
    const res = await call(async () => ({ data: [1] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [1] });
  });

  it("passes a Response through", async () => {
    const res = await call(async () =>
      Response.json({ ok: 1 }, { status: 201 }),
    );
    expect(res.status).toBe(201);
  });

  it("maps HttpError to { error, ...extra } with its status", async () => {
    const res = await call(async () => {
      throw new HttpError(409, "Price expired", { code: "quote_expired" });
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Price expired",
      code: "quote_expired",
    });
  });

  it("maps a Stripe card error to 402 with Stripe's message", async () => {
    const res = await call(async () => {
      throw Object.assign(new Error("Your card was declined."), {
        type: "StripeCardError",
      });
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Your card was declined." });
  });

  it("maps a request Stripe rejects to a logged 400 that hides Stripe's message", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const rejected = Object.assign(new Error("No such PaymentMethod: pm_x"), {
      type: "StripeInvalidRequestError",
    });
    const res = await call(async () => {
      throw rejected;
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "The payment could not be processed. Please try another card.",
    });
    expect(log).toHaveBeenCalledWith("Stripe rejected a request:", rejected);
  });

  it("maps other Stripe errors to 502 and hides the details", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(async () => {
      throw Object.assign(new Error("secret internals"), {
        type: "StripeAPIError",
      });
    });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("E7: maps anything else to a logged 500 with the generic message", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const boom = new TypeError("boom");
    const res = await call(async () => {
      throw boom;
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Something went wrong on our side. Please try again later.",
    });
    expect(log).toHaveBeenCalledWith("Unhandled API error:", boom);
  });
});

describe("readJson / requireEnv", () => {
  it("parses a JSON object body", async () => {
    await expect(readJson(jsonRequest("/x", { a: 1 }))).resolves.toEqual({
      a: 1,
    });
  });

  it.each([["{not json"], ["[1,2]"], ["null"], ['"text"']])(
    "is a 400 for %p",
    async (raw) => {
      await rejectsWith(readJson(jsonRequest("/x", raw)), 400);
    },
  );

  it("E7: requireEnv logs a missing variable by name, and its 500 names nothing", () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const thrownBy = (name: string, value?: string) => {
      try {
        requireEnv(value, name);
      } catch (error) {
        return error;
      }
      throw new Error("expected a throw");
    };
    expect(thrownBy("DJIR_TEST_UNSET")).toMatchObject(FAULT_500);
    expect(thrownBy("DJIR_TEST_EMPTY", "")).toMatchObject(FAULT_500);
    expect(log.mock.calls).toEqual([
      ["Missing environment variable DJIR_TEST_UNSET"],
      ["Missing environment variable DJIR_TEST_EMPTY"],
    ]);
    expect(requireEnv("value", "DJIR_TEST_SET")).toBe("value");
  });
});

describe("within", () => {
  it("E3 X20: resolves with the work's answer and clears its timer", async () => {
    jest.useFakeTimers();
    await expect(within(2000, Promise.resolve("answer"))).resolves.toBe(
      "answer",
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it("E3 X20: passes the work's own rejection through", async () => {
    const refused = new Error("refused");
    await expect(within(2000, Promise.reject(refused))).rejects.toBe(refused);
  });

  it("E3 X20: rejects once the time is up, and not a millisecond before", async () => {
    jest.useFakeTimers();
    let outcome = "waiting";
    within(2000, new Promise(() => {})).catch(
      (error: Error) => (outcome = error.message),
    );
    await jest.advanceTimersByTimeAsync(1999);
    expect(outcome).toBe("waiting");
    await jest.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("no answer within 2000 ms");
  });
});

describe("validators", () => {
  it("accepts and rejects numbers by range", () => {
    expect(requireNumber(45.8, "lat", { min: -90, max: 90 })).toBe(45.8);
    expect(() => requireNumber(91, "lat", { min: -90, max: 90 })).toThrow(
      "between",
    );
    expect(() => requireNumber("45", "lat")).toThrow("must be a number");
    expect(() => requireNumber(NaN, "lat")).toThrow("must be a number");
  });

  it("accepts positive integer ids only", () => {
    expect(requireInt(3, "driver_id")).toBe(3);
    expect(() => requireInt(0, "driver_id")).toThrow();
    expect(() => requireInt(1.5, "driver_id")).toThrow("must be an id");
  });

  it("X6: caps ids at the largest Postgres int, so an overflowing id is a 400 before any SQL", () => {
    expect(requireInt(2_147_483_647, "ride_id")).toBe(2_147_483_647);
    expect(() => requireInt(2_147_483_648, "ride_id")).toThrow(
      new HttpError(400, "ride_id must be between 1 and 2147483647"),
    );
    expect(() => requireInt(Number.MAX_SAFE_INTEGER, "ride_id")).toThrow(
      "between 1 and 2147483647",
    );
  });

  it("requires non-empty strings within a length", () => {
    expect(requireString("Trg bana Jelačića", "address")).toBe(
      "Trg bana Jelačića",
    );
    expect(() => requireString("  ", "address")).toThrow("address is required");
    expect(() => requireString("x".repeat(256), "address")).toThrow(
      "at most 255",
    );
  });

  it("validates a coordinate pair", () => {
    expect(requireLatLng(45.8, 15.9, "pickup")).toEqual({
      latitude: 45.8,
      longitude: 15.9,
    });
    expect(() => requireLatLng(45.8, 999, "pickup")).toThrow(
      "pickup longitude",
    );
  });

  it.each([
    ["2026-10-03T21:30:00Z", Date.UTC(2026, 9, 3, 21, 30)],
    ["2026-10-03T23:30:00+02:00", Date.UTC(2026, 9, 3, 21, 30)],
    ["2026-10-03T21:30:00.123Z", Date.UTC(2026, 9, 3, 21, 30, 0, 123)],
    [undefined, null],
    [null, null],
  ])("reads the instant %p", (value, ms) => {
    expect(optionalInstant(value, "scheduled_at")).toBe(ms);
  });

  it.each([
    ["2026-10-03T23:30"],
    ["2026-10-03"],
    ["tomorrow"],
    ["2026-13-45T99:99Z"],
    [1_700_000_000_000],
  ])("rejects %p (no offset, or not a time)", (value) => {
    expect(() => optionalInstant(value, "scheduled_at")).toThrow(
      "with an offset",
    );
  });
});

describe("requireBookableSlot", () => {
  // Now is off the grid (04:05Z), so the 5-min grace on the lead time shows.
  const SLOT_NOW = Date.parse("2026-10-05T04:05:00Z");
  const at = (time: string) => Date.parse(`2026-10-05T${time}Z`);
  const OFF_GRID =
    "Pickup times are every 15 minutes. Please choose another time.";
  const thrownBy = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return error;
    }
    return null;
  };

  it.each([["04:30:00"], ["06:15:00"]])(
    "K2 K13: accepts the grid slot %s (inside the lead time and horizon)",
    (time) => {
      expect(
        thrownBy(() => requireBookableSlot(at(time), SLOT_NOW, 400)),
      ).toBeNull();
    },
  );

  it.each([
    ["06:07:33", 400, OFF_GRID],
    ["06:15:00.001", 409, OFF_GRID],
    ["04:15:00", 409, "That pickup time is no longer available"],
  ] as const)(
    "K2 K13: refuses %s with a %i slot_unavailable",
    (time, status, message) => {
      expect(
        thrownBy(() => requireBookableSlot(at(time), SLOT_NOW, status)),
      ).toEqual(new HttpError(status, message, { code: "slot_unavailable" }));
    },
  );
});

describe("quoteTrip", () => {
  const trip = {
    pickup: { latitude: 45.8, longitude: 15.945 },
    dropoff: { latitude: 45.8085, longitude: 15.9775 },
    whenMs: Date.parse("2025-06-07T21:30:00Z"), // Sat 23:30 in Zagreb
  };
  const mlQuote = {
    eta_minutes: 9.7,
    surge_multiplier: 1.6,
    total_fare_eur: 9.74,
    trip_distance_km: 2.69,
    source: "ml-model",
  };
  const respond = (body: unknown, status = 200) =>
    jest.fn(
      async () => new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;

  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));

  it("uses the ML endpoint and sends it a UTC instant", async () => {
    const fetchImpl = respond(mlQuote);
    const q = await quoteTrip(trip, { mlUrl: "http://ml:8000/", fetchImpl });
    expect(q).toMatchObject({
      totalFareEur: 9.74,
      fareCents: 974,
      source: "ml-model",
    });
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe("http://ml:8000/predict-price");
    expect(JSON.parse(init.body).when).toBe("2025-06-07T21:30:00.000Z");
  });

  it.each([
    ["missing", undefined],
    ["not a string", 42],
  ])(
    'labels an ML quote "ml-model" when its source is %s',
    async (_, source) => {
      const fetchImpl = respond({ ...mlQuote, source });
      const q = await quoteTrip(trip, { mlUrl: "http://ml:8000", fetchImpl });
      expect(q).toEqual({
        etaMinutes: 9.7,
        surgeMultiplier: 1.6,
        totalFareEur: 9.74,
        tripDistanceKm: 2.69,
        source: "ml-model",
        fareCents: 974,
      });
    },
  );

  it("reads the endpoint from ML_ENDPOINT_URL by default", async () => {
    const saved = process.env.ML_ENDPOINT_URL;
    process.env.ML_ENDPOINT_URL = "http://ml.internal:8000";
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(mlQuote)));
    try {
      expect((await quoteTrip(trip)).source).toBe("ml-model");
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://ml.internal:8000/predict-price",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      if (saved === undefined) delete process.env.ML_ENDPOINT_URL;
      else process.env.ML_ENDPOINT_URL = saved;
    }
  });

  it("uses the heuristic when no endpoint is configured", async () => {
    const q = await quoteTrip(trip, {});
    expect(q.source).toBe("heuristic-fallback");
    expect(q.fareCents).toBe(Math.round(q.totalFareEur * 100));
  });

  it.each([
    ["an error status", respond({ detail: "x" }, 422)],
    ["a wrong shape", respond({ total_fare_eur: "9.74" })],
    ["a negative fare", respond({ ...mlQuote, total_fare_eur: -1 })],
    [
      "a network error",
      jest.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    ],
  ])("falls back to the heuristic on %s", async (_, fetchImpl) => {
    expect(
      (await quoteTrip(trip, { mlUrl: "http://ml:8000", fetchImpl })).source,
    ).toBe("heuristic-fallback");
  });

  /** A fetch that answers only by rejecting once its request is aborted. */
  const hanging = () =>
    jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );

  it("R18: gives up on a hanging endpoint after timeoutMs and uses the heuristic", async () => {
    const started = Date.now();
    const q = await quoteTrip(trip, {
      mlUrl: "http://ml:8000",
      fetchImpl: hanging() as unknown as typeof fetch,
      timeoutMs: 50,
    });
    expect(q.source).toBe("heuristic-fallback");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it(`R18: without timeoutMs, waits exactly ML_TIMEOUT_MS (${ML_TIMEOUT_MS} ms) before giving up`, async () => {
    jest.useFakeTimers();
    const hang = hanging();
    const pending = quoteTrip(trip, {
      mlUrl: "http://ml:8000",
      fetchImpl: hang as unknown as typeof fetch,
    });
    const { signal } = hang.mock.calls[0][1];
    jest.advanceTimersByTime(ML_TIMEOUT_MS - 1);
    expect(signal!.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal!.aborted).toBe(true);
    expect((await pending).source).toBe("heuristic-fallback");
  });
});
