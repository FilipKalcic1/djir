import { act, renderHook } from "@testing-library/react-native";

import { HISTORY_TICK_MS, SPEEDUP, useRides } from "@/hooks/useRides";
import { serverClockOffsetMs, setServerTime } from "@/services/clock";
import { syncReminders } from "@/services/reminders";
import { Ride } from "@/types/type";

import { settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import { auth, resetClerk } from "../helpers/mocks/clerk";
import { makeRide, MIN } from "../helpers/rides";

jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));
jest.mock("@/services/reminders", () => ({ syncReminders: jest.fn() }));

// Like expo-router's hook: runs when the screen gains focus (on mount, and
// whenever the effect changes while focused) and again each time the screen
// regains focus, which the shared mock cannot express.
const mockRefocus = new Set<() => void>();
jest.mock("expo-router", () => {
  const { useEffect, useState } = jest.requireActual("react");
  return {
    useFocusEffect(effect: () => void) {
      const [focusCount, setFocusCount] = useState(0);
      useEffect(() => {
        const refocus = () => setFocusCount((n: number) => n + 1);
        mockRefocus.add(refocus);
        return () => {
          mockRefocus.delete(refocus);
        };
      }, []);
      useEffect(effect, [effect, focusCount]);
    },
  };
});

const NOW = Date.parse("2026-10-04T05:40:00.000Z"); // the device clock: 07:40 in Zagreb
const iso = (ms: number) => new Date(ms).toISOString();
const mockSync = jest.mocked(syncReminders);

const realFetch = global.fetch;
const fetchMock = jest.fn();
/** GET /(api)/rides answers with `rides` and the server's clock. */
const history = (rides: Ride[], serverTimeMs = NOW) =>
  fetchResponse(200, { data: rides, server_time: iso(serverTimeMs) });

const ids = (rides: Ride[]) => rides.map((r) => r.ride_id);

async function mount(options?: { tickMs?: number }) {
  const hook = renderHook(() => useRides(options));
  await settle();
  return hook;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetClerk();
  setServerTime(iso(NOW), NOW);
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockSync.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("useRides — loading", () => {
  it("R47: a signed-out rider makes no request and has an empty, idle history", async () => {
    auth.userId = null;

    const { result } = await mount();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      rides: [],
      loading: false,
      error: null,
    });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("H6: opening the screen loads the signed-in rider's history once, with the session token", async () => {
    fetchMock.mockResolvedValue(history([makeRide()]));

    const { result } = await mount();

    expect(fetchMock.mock.calls).toEqual([
      [
        "/(api)/rides",
        {
          headers: { Authorization: "Bearer session-token" },
          signal: expect.objectContaining({ aborted: false }),
        },
      ],
    ]);
    expect(ids(result.current.rides)).toEqual([1]);
    expect(result.current.loading).toBe(false);
  });

  it("H6: signing in while the screen is open loads the history once", async () => {
    auth.userId = null;
    fetchMock.mockResolvedValue(history([makeRide()]));
    const { result, rerender } = await mount();

    auth.userId = "user_1";
    rerender({});
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ids(result.current.rides)).toEqual([1]);
  });

  it("H6: coming back to the screen reloads the history, so a ride booked elsewhere shows up", async () => {
    fetchMock
      .mockResolvedValueOnce(history([makeRide()]))
      .mockResolvedValueOnce(
        history([
          makeRide(),
          makeRide({ ride_id: 2, scheduled_at: "2026-10-05T06:00:00.000Z" }),
        ]),
      );
    const { result } = await mount();
    expect(ids(result.current.rides)).toEqual([1]);

    act(() => mockRefocus.forEach((refocus) => refocus()));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ids(result.current.rides)).toEqual([2, 1]);
  });

  it("R47: pull-to-refresh (refetch) reloads the history", async () => {
    fetchMock
      .mockResolvedValueOnce(history([makeRide()]))
      .mockResolvedValueOnce(history([]));
    const { result } = await mount();

    await act(() => result.current.refetch());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.rides).toEqual([]);
  });

  it("H10 S2: a history with no answer after 10 s ends in the error state, not an endless spinner", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    const { result } = await mount();

    act(() => jest.advanceTimersByTime(9_999));
    await settle();
    expect(result.current.loading).toBe(true);

    act(() => jest.advanceTimersByTime(1));
    await settle();

    expect(result.current).toMatchObject({
      rides: [],
      loading: false,
      error: "No answer from the server. Check your connection and try again.",
    });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("R47: a failed load shows the server's message and an empty history", async () => {
    fetchMock.mockResolvedValue(
      fetchResponse(500, { error: "Database unavailable" }),
    );

    const { result } = await mount();

    expect(result.current).toMatchObject({
      rides: [],
      loading: false,
      error: "Database unavailable",
    });
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("useRides — order and clock", () => {
  it("H1 H2 H3 H4 H5: rides come Live first, then Upcoming soonest-first, then the rest newest-first", async () => {
    const live = makeRide({ ride_id: 11, paid_at: "2026-10-04T05:35:00.000Z" });
    const soon = makeRide({
      ride_id: 12,
      scheduled_at: "2026-10-04T08:00:00.000Z",
    });
    const later = makeRide({
      ride_id: 13,
      scheduled_at: "2026-10-05T06:00:00.000Z",
    });
    const older = makeRide({ ride_id: 14 }); // paid 3 Oct 19:00
    const newer = makeRide({
      ride_id: 15,
      paid_at: "2026-10-04T02:00:00.000Z",
    });
    const cancelled = makeRide({
      ride_id: 16,
      scheduled_at: "2026-10-04T12:00:00.000Z",
      cancelled_at: "2026-10-04T05:00:00.000Z",
      payment_status: "refunded",
    });
    const legacy = makeRide({
      ride_id: 17,
      pickup_minutes: null,
      paid_at: "2026-10-01T10:00:00.000Z",
    });
    fetchMock.mockResolvedValue(
      history([older, later, cancelled, live, legacy, soon, newer]),
    );

    const { result } = await mount();

    expect(ids(result.current.rides)).toEqual([11, 12, 13, 16, 15, 14, 17]);
  });

  it("T4: with the device clock 5 min slow, nowMs and the order follow the server's clock as soon as the history loads", async () => {
    const serverNow = NOW + 5 * MIN;
    // Live on the server's clock (set off a minute ago); still Upcoming on the device's.
    const justLeft = makeRide({
      ride_id: 21,
      scheduled_at: iso(serverNow + 6 * MIN),
    });
    const rideNow = makeRide({
      ride_id: 22,
      paid_at: iso(serverNow - 2 * MIN),
    });
    fetchMock.mockResolvedValue(history([rideNow, justLeft], serverNow));

    const { result } = await mount();

    expect(result.current.clockOffsetMs).toBe(5 * MIN);
    expect(result.current.nowMs).toBe(NOW + 5 * MIN);
    expect(ids(result.current.rides)).toEqual([21, 22]); // both Live: newest pickup first
  });

  it("T4: before the history arrives, nowMs already follows the server clock an earlier response taught the app", async () => {
    setServerTime(iso(NOW + 5 * MIN), NOW); // e.g. Home's history, a screen ago
    fetchMock.mockReturnValue(new Promise(() => {})); // this screen's is still loading

    const { result } = await mount();

    expect(result.current.loading).toBe(true);
    expect(result.current.clockOffsetMs).toBe(5 * MIN);
    expect(result.current.nowMs).toBe(NOW + 5 * MIN);
  });

  it("H1: without a demo speed-up the history's clock ticks every 30 s by default", async () => {
    fetchMock.mockResolvedValue(history([makeRide()]));
    const { result } = await mount();

    act(() => jest.advanceTimersByTime(29_999));
    expect(result.current.nowMs).toBe(NOW);
    act(() => jest.advanceTimersByTime(1));

    expect([SPEEDUP, HISTORY_TICK_MS]).toEqual([1, 30_000]);
    expect(result.current.nowMs).toBe(NOW + 30_000);
  });

  it("B1a B1d: coming back to the screen reads the clock at once, before the refetch answers and without waiting for the tick", async () => {
    fetchMock
      .mockResolvedValueOnce(history([makeRide()]))
      .mockReturnValueOnce(new Promise(() => {}));
    const { result } = await mount({ tickMs: 30_000 });
    act(() => jest.advanceTimersByTime(10_000));
    expect(result.current.nowMs).toBe(NOW);

    act(() => mockRefocus.forEach((refocus) => refocus()));
    await settle(); // the refetch is sent, and never answers

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.nowMs).toBe(NOW + 10_000);
  });

  it("H1: the clock re-ticks every tickMs, so an Upcoming ride turns Live without a refetch", async () => {
    const leavesIn20s = makeRide({
      ride_id: 31,
      scheduled_at: iso(NOW + 20_000 + 7 * MIN),
    });
    const rideNow = makeRide({ ride_id: 32, paid_at: iso(NOW - 2 * MIN) });
    fetchMock.mockResolvedValue(history([leavesIn20s, rideNow]));
    const { result } = await mount({ tickMs: 30_000 });
    expect(ids(result.current.rides)).toEqual([32, 31]); // Live, then Upcoming

    act(() => jest.advanceTimersByTime(30_000));

    expect(result.current.nowMs).toBe(NOW + 30_000);
    expect(ids(result.current.rides)).toEqual([31, 32]); // both Live: newest pickup first
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });
});

describe("useRides — server clock and reminders (N7)", () => {
  const SERVER_NOW = NOW + 5 * MIN; // 05:45 UTC: the device is 5 min slow
  // Sets off 05:53, so its reminder (05:43) has passed on the server's clock but not the device's.
  const remindedAlready = makeRide({
    ride_id: 2,
    scheduled_at: "2026-10-04T06:00:00.000Z",
  });
  const tomorrow = makeRide({
    ride_id: 3,
    scheduled_at: "2026-10-05T06:00:00.000Z",
  });
  const cancelled = makeRide({
    ride_id: 4,
    scheduled_at: "2026-10-06T06:00:00.000Z",
    cancelled_at: "2026-10-04T05:00:00.000Z",
    payment_status: "refunded",
  });
  const rideNow = makeRide({ ride_id: 1 });

  it("N7: each load sets the server clock and syncs exactly the reminders the history calls for, on the server's clock", async () => {
    fetchMock
      .mockResolvedValueOnce(
        history([rideNow, remindedAlready, tomorrow, cancelled], SERVER_NOW),
      )
      .mockResolvedValueOnce(
        history(
          [
            rideNow,
            remindedAlready,
            { ...tomorrow, cancelled_at: "2026-10-04T05:44:00.000Z" },
            cancelled,
          ],
          SERVER_NOW,
        ),
      );

    const { result } = await mount();

    expect(serverClockOffsetMs()).toBe(5 * MIN);
    expect(mockSync.mock.calls).toEqual([
      [
        [
          {
            id: "ride-3",
            rideId: 3,
            atMs: Date.parse("2026-10-05T05:43:00.000Z"),
            title: "Your ride is almost here",
            body: "Michael sets off at 07:53 for your 08:00 pickup.",
          },
        ],
      ],
    ]);

    await act(() => result.current.refetch()); // ride 3 was cancelled on another device
    await settle();

    expect(mockSync).toHaveBeenCalledTimes(2);
    expect(mockSync).toHaveBeenLastCalledWith([]);
  });

  it("N7: a failed reminder sync is logged, not thrown, and the history still shows", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("Notifications unavailable");
    mockSync.mockRejectedValue(failure);
    fetchMock.mockResolvedValue(history([tomorrow], SERVER_NOW));

    const { result } = await mount();

    expect(warn).toHaveBeenCalledWith(
      "Could not update ride reminders:",
      failure,
    );
    expect(ids(result.current.rides)).toEqual([3]);
    expect(result.current.error).toBeNull();
  });
});
