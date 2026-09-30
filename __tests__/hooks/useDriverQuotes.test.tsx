import { act, renderHook } from "@testing-library/react-native";

import { useDriverQuotes } from "@/hooks/useDriverQuotes";
import { distanceKm, LatLng } from "@/lib/geo";
import { generateMarkersFromData } from "@/lib/map";
import { ApiError } from "@/services/api";
import { fetchQuote } from "@/services/quotes";
import {
  resetBookingFlow,
  resetSession,
  SLOT_EXPIRED_NOTICE,
  useBookingStore,
  useDriverStore,
  useLocationStore,
} from "@/store";
import { Driver, TripQuote } from "@/types/type";

import { deferred, settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import { resetClerk } from "../helpers/mocks/clerk";

jest.mock("@clerk/expo", () => require("../helpers/mocks/clerk"));
jest.mock("@/services/quotes", () => ({
  ...jest.requireActual("@/services/quotes"),
  fetchQuote: jest.fn(),
}));

const realFetchQuote =
  jest.requireActual<typeof import("@/services/quotes")>(
    "@/services/quotes",
  ).fetchQuote;
const mockFetchQuote = jest.mocked(fetchQuote);

const PICKUP = { latitude: 45.8, longitude: 15.945 };
const SQUARE = { latitude: 45.8131, longitude: 15.9772 };
const AIRPORT = { latitude: 45.7429, longitude: 16.0688 };
const SLOT = Date.parse("2026-10-05T06:00:00.000Z");

const driver = (id: number, first_name: string): Driver => ({
  id,
  first_name,
  last_name: "Driver",
  profile_image_url: null,
  car_image_url: null,
  car_seats: 4,
  rating: "4.80",
});
const DRIVERS = [driver(1, "James"), driver(2, "David"), driver(3, "Michael")];

const quote = (fareCents: number): TripQuote => ({
  token: `quote-${fareCents}`,
  fareCents,
  tripMinutes: 12,
  surgeMultiplier: 1,
  source: "ml",
  scheduledAt: null,
  issuedAtMs: Date.parse("2026-10-04T05:40:00.000Z"),
});

let driverRows: Driver[];
/** How GET /(api)/driver answers: the rows by default, or what a test queues. */
const driverAnswers: (() => unknown)[] = [];
/** Only an abort ends this request, as a real fetch that never hears back. */
const hang = (init: RequestInit) =>
  new Promise((_, reject) =>
    init.signal!.addEventListener("abort", () => reject(new Error("Aborted"))),
  );
const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
  if (url === "/(api)/driver") {
    const next = driverAnswers.shift();
    return next ? next() : fetchResponse(200, { data: driverRows });
  }
  return hang(init); // the quote endpoint never answers
});

const quoteState = () => {
  const { quoteStatus, quote, quoteError } = useDriverStore.getState();
  return { quoteStatus, quote, quoteError };
};
const signalOf = (call: number) => mockFetchQuote.mock.calls[call][3]!;
const setPickup = (at: LatLng = PICKUP) =>
  act(() =>
    useLocationStore
      .getState()
      .setUserLocation({ ...at, address: "Tresnjevka, Zagreb" }),
  );
const setDestination = (at: LatLng) =>
  act(() =>
    useLocationStore
      .getState()
      .setDestinationLocation({ ...at, address: "Somewhere, Zagreb" }),
  );

async function mount() {
  const hook = renderHook(() => useDriverQuotes());
  await settle();
  return hook;
}

beforeEach(() => {
  resetClerk();
  resetSession();
  driverRows = DRIVERS;
  driverAnswers.length = 0;
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockFetchQuote.mockReset();
});
afterEach(() => jest.useRealTimers());

describe("useDriverQuotes — the quote", () => {
  it("is idle with no destination, and asks for nothing", async () => {
    setPickup();
    act(() => useDriverStore.getState().setQuote("ready", quote(974))); // a previous trip's

    await mount();

    expect(mockFetchQuote).not.toHaveBeenCalled();
    expect(quoteState()).toEqual({
      quoteStatus: "idle",
      quote: null,
      quoteError: null,
    });
  });

  it("Q1 Q3: with a pickup and a destination it is loading, then holds the signed quote", async () => {
    const answer = deferred<TripQuote>();
    mockFetchQuote.mockReturnValueOnce(answer.promise);
    setPickup();
    setDestination(SQUARE);

    await mount();

    expect(mockFetchQuote).toHaveBeenCalledTimes(1);
    expect(mockFetchQuote).toHaveBeenCalledWith(
      PICKUP,
      SQUARE,
      null,
      expect.objectContaining({ aborted: false }),
    );
    expect(quoteState()).toEqual({
      quoteStatus: "loading",
      quote: null,
      quoteError: null,
    });

    answer.resolve(quote(974));
    await settle();

    expect(quoteState()).toEqual({
      quoteStatus: "ready",
      quote: quote(974),
      quoteError: null,
    });
  });

  it("Q2: a failed quote shows its message", async () => {
    mockFetchQuote.mockRejectedValueOnce(
      new Error("Trips over 60 km are outside the service area"),
    );
    setPickup();
    setDestination(SQUARE);

    await mount();

    expect(quoteState()).toEqual({
      quoteStatus: "error",
      quote: null,
      quoteError: "Trips over 60 km are outside the service area",
    });
    expect(useBookingStore.getState().slotNotice).toBeNull();
  });

  it("P3c: a refresh that fails keeps the previous quote, with the error", async () => {
    mockFetchQuote
      .mockResolvedValueOnce(quote(974))
      .mockRejectedValueOnce(
        new Error("Couldn't get prices. Check your connection and try again."),
      );
    setPickup();
    setDestination(SQUARE);
    await mount();

    act(() => useDriverStore.getState().requestQuote());
    await settle();

    expect(mockFetchQuote).toHaveBeenCalledTimes(2);
    expect(quoteState()).toEqual({
      quoteStatus: "error",
      quote: quote(974),
      quoteError: "Couldn't get prices. Check your connection and try again.",
    });
  });

  it("K6: a quote answered 400 slot_unavailable goes back to Now with the K5 notice, then quotes a ride now", async () => {
    const statusWhenExpired: string[] = [];
    const unsubscribe = useBookingStore.subscribe((booking) => {
      if (booking.slotNotice !== null) {
        statusWhenExpired.push(useDriverStore.getState().quoteStatus);
      }
    });
    const nowQuote = deferred<TripQuote>();
    mockFetchQuote
      .mockRejectedValueOnce(
        new ApiError("That pickup time is no longer available", 400, {
          error: "That pickup time is no longer available",
          code: "slot_unavailable",
        }),
      )
      .mockReturnValueOnce(nowQuote.promise);
    act(() => useBookingStore.getState().setScheduledAt(SLOT));
    setPickup();
    setDestination(SQUARE);

    await mount();
    unsubscribe();

    expect(mockFetchQuote.mock.calls.map((call) => call[2])).toEqual([
      SLOT,
      null,
    ]);
    expect(useBookingStore.getState()).toMatchObject({
      scheduledAt: null,
      slotNotice: SLOT_EXPIRED_NOTICE,
    });
    // The failure lands before the slot resets, so a waiting Payment stops (P3c).
    expect(statusWhenExpired).toEqual(["error"]);
    expect(quoteState()).toEqual({
      quoteStatus: "loading",
      quote: null,
      quoteError: null,
    });
  });

  it("K6: a 400 with another code leaves the pickup time alone", async () => {
    mockFetchQuote.mockRejectedValueOnce(
      new ApiError("Trips over 60 km are outside the service area", 400, {
        error: "Trips over 60 km are outside the service area",
        code: "out_of_area",
      }),
    );
    act(() => useBookingStore.getState().setScheduledAt(SLOT));
    setPickup();
    setDestination(SQUARE);

    await mount();

    expect(mockFetchQuote).toHaveBeenCalledTimes(1);
    expect(useBookingStore.getState()).toMatchObject({
      scheduledAt: SLOT,
      slotNotice: null,
    });
    expect(quoteState().quoteStatus).toBe("error");
  });

  it.each([
    ["before", ["stale", "latest"]],
    ["after", ["latest", "stale"]],
  ] as const)(
    "R18: when the destination changes mid-flight, the stale quote is dropped and only the latest lands (stale arrives %s)",
    async (_, order) => {
      const answers = {
        stale: deferred<TripQuote>(),
        latest: deferred<TripQuote>(),
      };
      mockFetchQuote
        .mockReturnValueOnce(answers.stale.promise)
        .mockReturnValueOnce(answers.latest.promise);
      setPickup();
      setDestination(SQUARE);
      await mount();

      setDestination(AIRPORT);

      expect(mockFetchQuote.mock.calls[1].slice(0, 3)).toEqual([
        PICKUP,
        AIRPORT,
        null,
      ]);
      expect(signalOf(0).aborted).toBe(true);
      expect(signalOf(1).aborted).toBe(false);
      const fares = { stale: 586, latest: 2150 };
      answers[order[0]].resolve(quote(fares[order[0]]));
      await settle();
      answers[order[1]].resolve(quote(fares[order[1]]));
      await settle();
      expect(quoteState()).toEqual({
        quoteStatus: "ready",
        quote: quote(2150),
        quoteError: null,
      });
    },
  );

  it("R18: a stale quote arriving first does not end the loading state", async () => {
    const stale = deferred<TripQuote>();
    mockFetchQuote
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(new Promise(() => {}));
    setPickup();
    setDestination(SQUARE);
    await mount();
    setDestination(AIRPORT);

    stale.resolve(quote(586));
    await settle();

    expect(quoteState()).toEqual({
      quoteStatus: "loading",
      quote: null,
      quoteError: null,
    });
  });

  it("R18: a stale request's failure is dropped too", async () => {
    const stale = deferred<TripQuote>();
    mockFetchQuote
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(new Promise(() => {}));
    setPickup();
    setDestination(SQUARE);
    await mount();
    setDestination(AIRPORT);

    stale.reject(new Error("Aborted"));
    await settle();

    expect(quoteState().quoteStatus).toBe("loading");
    expect(quoteState().quoteError).toBeNull();
  });

  it("R18: clearing the destination (after a booking) goes back to idle and drops the in-flight quote", async () => {
    const inFlight = deferred<TripQuote>();
    mockFetchQuote.mockReturnValueOnce(inFlight.promise);
    setPickup();
    setDestination(SQUARE);
    await mount();

    act(() => resetBookingFlow());
    inFlight.resolve(quote(974));
    await settle();

    expect(signalOf(0).aborted).toBe(true);
    expect(mockFetchQuote).toHaveBeenCalledTimes(1);
    expect(quoteState()).toEqual({
      quoteStatus: "idle",
      quote: null,
      quoteError: null,
    });
  });

  it("R18: unmounting aborts the in-flight quote, which never lands", async () => {
    const inFlight = deferred<TripQuote>();
    mockFetchQuote.mockReturnValueOnce(inFlight.promise);
    setPickup();
    setDestination(SQUARE);
    const { unmount } = await mount();

    unmount();
    inFlight.resolve(quote(974));
    await settle();

    expect(signalOf(0).aborted).toBe(true);
    expect(quoteState().quoteStatus).toBe("loading");
    expect(quoteState().quote).toBeNull();
  });

  it("Q1 Q2: Retry (requestQuote) asks again for the same trip; the price already shown stays until the new one lands", async () => {
    const retry = deferred<TripQuote>();
    mockFetchQuote
      .mockResolvedValueOnce(quote(974))
      .mockReturnValueOnce(retry.promise);
    setPickup();
    setDestination(SQUARE);
    await mount();
    expect(quoteState().quote).toEqual(quote(974));

    act(() => useDriverStore.getState().requestQuote());

    expect(mockFetchQuote).toHaveBeenCalledTimes(2);
    expect(mockFetchQuote.mock.calls[1].slice(0, 3)).toEqual([
      PICKUP,
      SQUARE,
      null,
    ]);
    expect(quoteState()).toEqual({
      quoteStatus: "loading",
      quote: quote(974),
      quoteError: null,
    });
    retry.resolve(quote(1012));
    await settle();
    expect(quoteState()).toEqual({
      quoteStatus: "ready",
      quote: quote(1012),
      quoteError: null,
    });
  });

  it("quotes the chosen pickup time, and re-quotes (aborting the old request) when it changes", async () => {
    mockFetchQuote.mockReturnValue(new Promise(() => {}));
    act(() => useBookingStore.getState().setScheduledAt(SLOT));
    setPickup();
    setDestination(SQUARE);
    await mount();
    expect(mockFetchQuote.mock.calls[0].slice(0, 3)).toEqual([
      PICKUP,
      SQUARE,
      SLOT,
    ]);

    act(() => useBookingStore.getState().setScheduledAt(SLOT + 15 * 60_000));

    expect(signalOf(0).aborted).toBe(true);
    expect(mockFetchQuote.mock.calls[1].slice(0, 3)).toEqual([
      PICKUP,
      SQUARE,
      SLOT + 15 * 60_000,
    ]);
  });

  it("R18: a quote with no answer after 8 s ends in the error state with the retry message", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-10-04T05:40:00.000Z") });
    mockFetchQuote.mockImplementation(realFetchQuote);
    setPickup();
    setDestination(SQUARE);
    await mount();

    act(() => jest.advanceTimersByTime(7999));
    await settle();
    expect(quoteState().quoteStatus).toBe("loading");

    act(() => jest.advanceTimersByTime(1));
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      "/(api)/predict-price",
      expect.objectContaining({ method: "POST" }),
    );
    expect(quoteState()).toEqual({
      quoteStatus: "error",
      quote: null,
      quoteError: "Couldn't get prices. Check your connection and try again.",
    });
  });
});

describe("useDriverQuotes — drivers", () => {
  const positions = () =>
    Object.fromEntries(
      useDriverStore
        .getState()
        .drivers.map((d) => [d.id, [d.latitude, d.longitude]]),
    );

  it("R12: places the drivers from GET /(api)/driver around the pickup, each on the 1.5–4 km ring", async () => {
    setPickup();

    await mount();

    expect(fetchMock).toHaveBeenCalledWith("/(api)/driver", {
      headers: {},
      signal: expect.objectContaining({ aborted: false }),
    });
    const { drivers } = useDriverStore.getState();
    expect(drivers).toEqual(
      generateMarkersFromData({ data: DRIVERS, pickup: PICKUP }),
    );
    expect(drivers.map((d) => d.title)).toEqual([
      "James Driver",
      "David Driver",
      "Michael Driver",
    ]);
    for (const d of drivers) {
      expect(distanceKm(PICKUP, d)).toBeGreaterThanOrEqual(1.5 - 1e-6);
      expect(distanceKm(PICKUP, d)).toBeLessThanOrEqual(4 + 1e-6);
    }
    expect(
      new Set(drivers.map((d) => `${d.latitude},${d.longitude}`)).size,
    ).toBe(3);
  });

  it("R12: a driver's spot depends on its id only, not on the order the API lists drivers in", async () => {
    setPickup();
    const first = await mount();
    const listed = positions();
    first.unmount();
    act(() => useDriverStore.getState().reset());

    driverRows = [...DRIVERS].reverse();
    await mount();

    expect(positions()).toEqual(listed);
  });

  it("R12: places no driver until the pickup is known, then re-places them around a new pickup", async () => {
    await mount();
    expect(useDriverStore.getState().drivers).toEqual([]);

    setPickup();
    expect(useDriverStore.getState().drivers).toEqual(
      generateMarkersFromData({ data: DRIVERS, pickup: PICKUP }),
    );

    setPickup(SQUARE);
    expect(useDriverStore.getState().drivers).toEqual(
      generateMarkersFromData({ data: DRIVERS, pickup: SQUARE }),
    );
  });
});

describe("useDriverQuotes — how the drivers loaded (Q5, Q6)", () => {
  const load = () => {
    const { drivers, driversStatus, driversError } = useDriverStore.getState();
    return { count: drivers.length, driversStatus, driversError };
  };
  const driverCalls = () =>
    fetchMock.mock.calls.filter(([url]) => url === "/(api)/driver").length;

  it("Q5: while GET /(api)/driver is in flight the status is loading", async () => {
    const answer = deferred<unknown>();
    driverAnswers.push(() => answer.promise);
    setPickup();

    await mount();

    expect(load()).toEqual({
      count: 0,
      driversStatus: "loading",
      driversError: null,
    });
    answer.resolve(fetchResponse(200, { data: DRIVERS }));
    await settle();
    expect(load()).toEqual({
      count: 3,
      driversStatus: "ready",
      driversError: null,
    });
  });

  it.each([
    [
      "a network error",
      () => Promise.reject(new TypeError("Network request failed")),
      "Network request failed",
    ],
    [
      "a server error",
      () => fetchResponse(503, { error: "Database unavailable" }),
      "Database unavailable",
    ],
  ])(
    "Q5: %s is recorded as the error, with its message, and no driver is placed",
    async (_, answer, message) => {
      driverAnswers.push(answer);
      setPickup();

      await mount();

      expect(load()).toEqual({
        count: 0,
        driversStatus: "error",
        driversError: message,
      });
    },
  );

  it("Q5: reloadDrivers loads them again: loading, then placed and ready", async () => {
    driverAnswers.push(() =>
      Promise.reject(new TypeError("Network request failed")),
    );
    setPickup();
    await mount();
    expect(load().driversStatus).toBe("error");

    act(() => useDriverStore.getState().reloadDrivers());
    expect(load()).toEqual({
      count: 0,
      driversStatus: "loading",
      driversError: null,
    });
    await settle();

    expect(driverCalls()).toBe(2);
    expect(load()).toEqual({
      count: 3,
      driversStatus: "ready",
      driversError: null,
    });
    expect(useDriverStore.getState().drivers).toEqual(
      generateMarkersFromData({ data: DRIVERS, pickup: PICKUP }),
    );
  });

  it("Q5: a reload asked for before this mount is not repeated by the mount", async () => {
    act(() => useDriverStore.getState().reloadDrivers());
    setPickup();

    await mount();

    expect(driverCalls()).toBe(1);
    expect(load().driversStatus).toBe("ready");
  });

  it("Q5: with no answer after 10 s the load fails with 'No answer from the server…'", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-10-04T05:40:00.000Z") });
    driverAnswers.push(() => hang(fetchMock.mock.calls.at(-1)![1]));
    setPickup();
    await mount();

    act(() => jest.advanceTimersByTime(9_999));
    await settle();
    expect(load().driversStatus).toBe("loading");

    act(() => jest.advanceTimersByTime(1));
    await settle();

    expect(load()).toEqual({
      count: 0,
      driversStatus: "error",
      driversError:
        "No answer from the server. Check your connection and try again.",
    });
  });

  it("Q6: an empty driver list loads as ready, with no driver placed", async () => {
    driverRows = [];
    setPickup();

    await mount();

    expect(load()).toEqual({
      count: 0,
      driversStatus: "ready",
      driversError: null,
    });
  });
});
