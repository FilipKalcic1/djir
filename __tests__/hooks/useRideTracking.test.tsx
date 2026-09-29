import { act, renderHook } from "@testing-library/react-native";

import { useRideTracking } from "@/hooks/useRideTracking";
import {
  PositionSource,
  simulatedPosition,
  TrackedRide,
  trackedRideFrom,
  TrackingSnapshot,
} from "@/lib/tracking";

import { makeRide, MIN } from "../helpers/rides";

const PAID = Date.parse("2026-10-03T19:00:00.000Z");
const TICK = 1000;
const tracked = trackedRideFrom(makeRide())!;
const PICKUP = { latitude: 45.8, longitude: 15.945 };
const DESTINATION = { latitude: 45.8085, longitude: 15.9775 };
const LEGS = {
  toPickup: [tracked.driverStart, PICKUP],
  toDestination: [PICKUP, DESTINATION],
};

/** A PositionSource that only records what it was asked. */
const fakeSource = () =>
  jest.fn<TrackingSnapshot, Parameters<PositionSource>>(
    (ride, _legs, nowMs) => ({
      phase: "en_route",
      minutesLeft: (ride.timeline.departAtMs + 7 * MIN - nowMs) / MIN,
      legProgress: 0,
      car: ride.driverStart,
      headingDeg: 0,
    }),
  );

let clockMs: number;
const now = () => clockMs;
const lastNowMs = (source: ReturnType<typeof fakeSource>) =>
  source.mock.calls.at(-1)![2];

beforeEach(() => {
  jest.useFakeTimers({ now: PAID });
  clockMs = PAID + 2 * MIN;
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("useRideTracking", () => {
  it("T10: the first render is already the source's snapshot for the ride, its straight legs and now()", () => {
    const source = fakeSource();

    const { result } = renderHook(() =>
      useRideTracking(tracked, { source, now, tickMs: TICK }),
    );

    expect(source).toHaveBeenCalledWith(tracked, LEGS, PAID + 2 * MIN);
    expect(
      source.mock.calls.every(([, , nowMs]) => nowMs === PAID + 2 * MIN),
    ).toBe(true);
    expect(result.current).toBe(source.mock.results.at(-1)!.value);
    expect(result.current!.minutesLeft).toBe(5);
  });

  it("recomputes from now() every tickMs, and not before", () => {
    const source = fakeSource();
    const { result } = renderHook(() =>
      useRideTracking(tracked, { source, now, tickMs: TICK }),
    );

    clockMs = PAID + 3 * MIN;
    act(() => jest.advanceTimersByTime(TICK - 1));
    expect(lastNowMs(source)).toBe(PAID + 2 * MIN);

    act(() => jest.advanceTimersByTime(1));
    expect(source).toHaveBeenLastCalledWith(tracked, LEGS, PAID + 3 * MIN);
    expect(result.current!.minutesLeft).toBe(4);

    clockMs = PAID + 4 * MIN;
    act(() => jest.advanceTimersByTime(TICK));
    expect(result.current!.minutesLeft).toBe(3);
  });

  it("T10: a new now function on every render keeps one interval running, and the tick reads the latest one", () => {
    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");
    const source = fakeSource();
    const { rerender } = renderHook(
      ({ offsetMs }: { offsetMs: number }) =>
        useRideTracking(tracked, {
          source,
          now: () => clockMs + offsetMs, // a fresh closure per render, as track-ride.tsx passes
          tickMs: TICK,
        }),
      { initialProps: { offsetMs: 0 } },
    );

    act(() => jest.advanceTimersByTime(TICK / 2));
    rerender({ offsetMs: 1 * MIN });
    rerender({ offsetMs: 2 * MIN });
    act(() => jest.advanceTimersByTime(TICK / 2 - 1));
    expect(lastNowMs(source)).toBe(PAID + 2 * MIN);

    act(() => jest.advanceTimersByTime(1));

    expect(lastNowMs(source)).toBe(PAID + 4 * MIN);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), TICK);
    expect(clearIntervalSpy).not.toHaveBeenCalled();
  });

  it("restarts the interval at the new period when tickMs changes (sped-up demo)", () => {
    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");
    const source = fakeSource();
    const { rerender } = renderHook(
      ({ tickMs }: { tickMs: number }) =>
        useRideTracking(tracked, { source, now, tickMs }),
      { initialProps: { tickMs: TICK } },
    );
    const firstId = setIntervalSpy.mock.results[0].value;

    rerender({ tickMs: 250 });
    clockMs = PAID + 3 * MIN;
    act(() => jest.advanceTimersByTime(250));

    expect(clearIntervalSpy).toHaveBeenCalledWith(firstId);
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), 250);
    expect(lastNowMs(source)).toBe(PAID + 3 * MIN);
    expect(jest.getTimerCount()).toBe(1);
  });

  it("is null without a ride, and never asks the source", () => {
    const source = fakeSource();

    const { result } = renderHook(() =>
      useRideTracking(null, { source, now, tickMs: TICK }),
    );
    act(() => jest.advanceTimersByTime(3 * TICK));

    expect(result.current).toBeNull();
    expect(source).not.toHaveBeenCalled();
  });

  it("starts tracking as soon as the ride arrives (history loaded after mount)", () => {
    const source = fakeSource();
    const { result, rerender } = renderHook(
      ({ ride }: { ride: TrackedRide | null }) =>
        useRideTracking(ride, { source, now, tickMs: TICK }),
      { initialProps: { ride: null as TrackedRide | null } },
    );
    expect(result.current).toBeNull();

    rerender({ ride: tracked });

    expect(source).toHaveBeenLastCalledWith(tracked, LEGS, PAID + 2 * MIN);
    expect(result.current!.minutesLeft).toBe(5);
  });

  it("clears its interval on unmount", () => {
    const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval");
    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    const source = fakeSource();
    const { unmount } = renderHook(() =>
      useRideTracking(tracked, { source, now, tickMs: TICK }),
    );
    const calls = source.mock.calls.length;

    unmount();
    act(() => jest.advanceTimersByTime(5 * TICK));

    expect(clearIntervalSpy).toHaveBeenCalledWith(
      setIntervalSpy.mock.results[0].value,
    );
    expect(jest.getTimerCount()).toBe(0);
    expect(source).toHaveBeenCalledTimes(calls);
  });

  it("defaults to the device clock (Date.now) and 1 s ticks", () => {
    const source = fakeSource();

    renderHook(() => useRideTracking(tracked, { source }));
    expect(lastNowMs(source)).toBe(PAID);
    act(() => jest.advanceTimersByTime(999));
    expect(lastNowMs(source)).toBe(PAID);
    act(() => jest.advanceTimersByTime(1));

    expect(lastNowMs(source)).toBe(PAID + 1000);
  });

  it("T10: after an app restart the simulated ride resumes at the same phase, minutes left and leg progress", () => {
    const source = simulatedPosition();
    const at = () => PAID + 14 * MIN; // 7 min pickup + 1 min boarding + 6 of 12 trip minutes
    const first = renderHook(() =>
      useRideTracking(tracked, { source, now: at, tickMs: TICK }),
    );
    const before = first.result.current;
    first.unmount();

    const { result } = renderHook(() =>
      useRideTracking(tracked, { source, now: at, tickMs: TICK }),
    );

    expect(result.current).toMatchObject({
      phase: "on_trip",
      minutesLeft: 6,
      legProgress: 0.5,
    });
    expect(result.current).toEqual(before);
  });
});
