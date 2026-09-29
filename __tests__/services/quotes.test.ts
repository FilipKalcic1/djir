/**
 * services/quotes — a signed quote from /(api)/predict-price. Only `fetch` is
 * faked; fetchAPI and the server clock are real. The device clock is fixed.
 */
import { ApiError } from "@/services/api";
import { serverClockOffsetMs, setServerTime } from "@/services/clock";
import { fetchQuote, QUOTE_TIMEOUT_MS } from "@/services/quotes";

const NOW = Date.parse("2026-10-03T19:00:00.000Z");
const PICKUP = { latitude: 45.8, longitude: 15.945 };
const DROPOFF = { latitude: 45.8085, longitude: 15.9775 };
const SLOT = Date.parse("2026-10-05T06:00:00.000Z");

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const wire = (overrides: Record<string, unknown> = {}) => ({
  quote_token: "qt_signed",
  fare_cents: 974,
  trip_minutes: 12,
  surge_multiplier: 1.4,
  source: "ml",
  scheduled_at: null,
  server_time: "2026-10-03T19:00:03.000Z",
  ...overrides,
});
const replyWith = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
/** A request that only ends when its signal aborts, as `fetch` does. */
const hangUntilAborted = () =>
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const abort = () =>
          reject(new DOMException("The operation was aborted.", "AbortError"));
        // Like fetch: an already-aborted signal rejects at once.
        if (init.signal!.aborted) abort();
        init.signal!.addEventListener("abort", abort);
      }),
  );
const sentSignal = () => fetchMock.mock.calls[0][1].signal!;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  fetchMock.mockReset();
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((url, init) => fetchMock(url as string, init!));
  setServerTime(new Date(NOW).toISOString(), NOW);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("fetchQuote — request and mapping", () => {
  it("POSTs pickup and dropoff (no scheduled_at for a ride now), without a session token", async () => {
    replyWith(200, wire());

    await fetchQuote(PICKUP, DROPOFF, null);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/(api)/predict-price");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      pickup_lat: 45.8,
      pickup_lng: 15.945,
      dropoff_lat: 45.8085,
      dropoff_lng: 15.9775,
    });
  });

  it("sends a scheduled pickup as a UTC ISO instant", async () => {
    replyWith(200, wire({ scheduled_at: "2026-10-05T06:00:00.000Z" }));

    await fetchQuote(PICKUP, DROPOFF, SLOT);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      pickup_lat: 45.8,
      pickup_lng: 15.945,
      dropoff_lat: 45.8085,
      dropoff_lng: 15.9775,
      scheduled_at: "2026-10-05T06:00:00.000Z",
    });
  });

  it("maps the wire response to a TripQuote exactly, stamped with the device receipt time", async () => {
    replyWith(200, wire({ scheduled_at: "2026-10-05T06:00:00.000Z" }));

    await expect(fetchQuote(PICKUP, DROPOFF, SLOT)).resolves.toEqual({
      token: "qt_signed",
      fareCents: 974,
      tripMinutes: 12,
      surgeMultiplier: 1.4,
      source: "ml",
      scheduledAt: SLOT,
      issuedAtMs: NOW,
    });
  });

  it("maps a null scheduled_at to a ride now", async () => {
    replyWith(200, wire({ surge_multiplier: 1, source: "heuristic" }));

    const quote = await fetchQuote(PICKUP, DROPOFF, null);

    expect(quote.scheduledAt).toBeNull();
    expect(quote.surgeMultiplier).toBe(1);
    expect(quote.source).toBe("heuristic");
  });

  it("records the response's server_time as the server clock offset", async () => {
    replyWith(200, wire({ server_time: "2026-10-03T19:05:00.000Z" }));

    await fetchQuote(PICKUP, DROPOFF, null);

    expect(serverClockOffsetMs()).toBe(5 * 60_000);
  });

  it("clears its timeout once the quote arrives", async () => {
    replyWith(200, wire());

    await fetchQuote(PICKUP, DROPOFF, null);

    expect(jest.getTimerCount()).toBe(0);
    expect(sentSignal().aborted).toBe(false);
  });
});

describe("fetchQuote — failures", () => {
  it("R18: gives up after QUOTE_TIMEOUT_MS (8 s) with a clear message", async () => {
    expect(QUOTE_TIMEOUT_MS).toBe(8000);
    hangUntilAborted();
    const settled = jest.fn();
    const result = fetchQuote(PICKUP, DROPOFF, null).then(settled, (e) => {
      settled();
      return e;
    });

    await jest.advanceTimersByTimeAsync(7999);
    expect(settled).not.toHaveBeenCalled();
    expect(sentSignal().aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    const error = await result;
    expect(sentSignal().aborted).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      "Couldn't get prices. Check your connection and try again.",
    );
  });

  it("R18: a caller abort cancels the request and rejects with the AbortError, not the timeout message", async () => {
    hangUntilAborted();
    const caller = new AbortController();
    const result = fetchQuote(PICKUP, DROPOFF, null, caller.signal).catch(
      (e) => e,
    );

    caller.abort();
    const error = await result;

    expect(sentSignal().aborted).toBe(true);
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe("AbortError");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("R18: a signal that is already aborted cancels the request at once", async () => {
    hangUntilAborted();
    const caller = new AbortController();
    caller.abort();

    const error = await fetchQuote(PICKUP, DROPOFF, null, caller.signal).catch(
      (e) => e,
    );

    expect(sentSignal().aborted).toBe(true);
    expect(error.name).toBe("AbortError");
  });

  it("R18: stops listening to the caller's signal once settled", async () => {
    replyWith(200, wire());
    const caller = new AbortController();

    await fetchQuote(PICKUP, DROPOFF, null, caller.signal);
    caller.abort();

    expect(sentSignal().aborted).toBe(false);
  });

  it("passes the server's error through unchanged and leaves the clock alone", async () => {
    replyWith(422, { error: "That trip is longer than 60 km." });

    const error = await fetchQuote(PICKUP, DROPOFF, null).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "That trip is longer than 60 km.",
      status: 422,
    });
    expect(serverClockOffsetMs()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("passes a network error through unchanged", async () => {
    const offline = new TypeError("Network request failed");
    fetchMock.mockRejectedValueOnce(offline);

    await expect(fetchQuote(PICKUP, DROPOFF, null)).rejects.toBe(offline);
  });
});
