import { act, renderHook } from "@testing-library/react-native";

import { useNow } from "@/hooks/useNow";

import { MIN } from "../helpers/rides";

const NOW = Date.parse("2026-10-03T19:00:00.000Z");

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe("useNow", () => {
  it("returns the device clock shifted by the server offset", () => {
    const { result } = renderHook(() => useNow(30_000, 5 * MIN));

    expect(result.current).toBe(NOW + 5 * MIN);
  });

  it("re-renders every intervalMs with the shifted clock, and not before", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useNow(1000, -2000);
    });
    const rendersAfterMount = renders;

    act(() => jest.advanceTimersByTime(999));
    expect(result.current).toBe(NOW - 2000);
    expect(renders).toBe(rendersAfterMount);

    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(NOW + 1000 - 2000);
    expect(renders).toBe(rendersAfterMount + 1);

    act(() => jest.advanceTimersByTime(1000));
    expect(result.current).toBe(NOW + 2000 - 2000);
  });

  it("ticks every 30 s with no offset by default", () => {
    const { result } = renderHook(() => useNow());

    act(() => jest.advanceTimersByTime(29_999));
    expect(result.current).toBe(NOW);

    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(NOW + 30_000);
  });

  it("applies a changed offset immediately, without waiting for the next tick", () => {
    const { result, rerender } = renderHook(
      ({ offsetMs }: { offsetMs: number }) => useNow(30_000, offsetMs),
      { initialProps: { offsetMs: 0 } },
    );
    act(() => jest.advanceTimersByTime(10_000));

    rerender({ offsetMs: 5 * MIN });

    expect(result.current).toBe(NOW + 10_000 + 5 * MIN);
    act(() => jest.advanceTimersByTime(30_000));
    expect(result.current).toBe(NOW + 40_000 + 5 * MIN);
  });

  it("B1a B1d: a new restartKey (the screen back in focus) reads the clock at once and restarts the tick from there", () => {
    const { result, rerender } = renderHook(
      ({ focus }: { focus: number }) => useNow(30_000, 0, focus),
      { initialProps: { focus: 0 } },
    );
    act(() => jest.advanceTimersByTime(10_000));
    expect(result.current).toBe(NOW);

    rerender({ focus: 1 });

    expect(result.current).toBe(NOW + 10_000);
    act(() => jest.advanceTimersByTime(29_999));
    expect(result.current).toBe(NOW + 10_000);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(NOW + 40_000);
  });

  it("stops ticking when unmounted", () => {
    const { unmount } = renderHook(() => useNow(1000));
    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
