/**
 * useRides under the demo speed-up (EXPO_PUBLIC_TRACKING_SPEEDUP=20 in a dev
 * build, where each real 3 s is a simulated minute): the history's clock must
 * tick as fast as the tracker's, or the Home banner's lines (B1a, B1d, B1b)
 * lag the tracker by up to ten simulated minutes. The speed-up is read when the
 * module loads, so it is set for this whole file.
 */
import { act, renderHook } from "@testing-library/react-native";

import { HISTORY_TICK_MS, SPEEDUP, useRides } from "@/hooks/useRides";
import { setServerTime } from "@/services/clock";

import { settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import { resetClerk } from "../helpers/mocks/clerk";
import { makeRide, MIN } from "../helpers/rides";

jest.mock("@clerk/expo", () => require("../helpers/mocks/clerk"));
jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@/services/reminders", () => ({
  syncReminders: jest.fn(async () => {}),
}));
jest.mock("@/lib/tracking", () => ({
  ...jest.requireActual("@/lib/tracking"),
  trackingSpeedup: () => 20,
}));

const PAID = Date.parse("2026-10-03T19:00:00.000Z");
const realFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers({ now: PAID });
  resetClerk();
  setServerTime(new Date(PAID).toISOString(), PAID);
  global.fetch = jest.fn(async () =>
    fetchResponse(200, {
      data: [makeRide()], // paid at PAID, pickup 7 min, trip 12 min
      server_time: new Date(PAID).toISOString(),
    }),
  ) as never;
});
afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

it("B1a B1b B1d: at ×20 the history's clock ticks every 250 ms by default, like the tracker's", async () => {
  const { result } = renderHook(() => useRides());
  await settle();

  act(() => jest.advanceTimersByTime(249));
  expect(result.current.nowMs).toBe(PAID);
  act(() => jest.advanceTimersByTime(1));

  expect([SPEEDUP, HISTORY_TICK_MS]).toEqual([20, 250]);
  expect(result.current.nowMs).toBe(PAID + 250);
});

it("B1d B1b: at ×20 the banner's clock reaches the pickup leg's last minute and the arrival within their 3-second windows", async () => {
  const { result } = renderHook(() => useRides());
  await settle();

  // 6.25 simulated minutes in: the last minute of the 7-minute pickup leg.
  act(() => jest.advanceTimersByTime((6.25 * MIN) / 20));
  expect(result.current.nowMs).toBe(PAID + (6.25 * MIN) / 20);
  // 7.25 simulated minutes in: the driver has arrived (a 1-minute window).
  act(() => jest.advanceTimersByTime(MIN / 20));
  expect(result.current.nowMs).toBe(PAID + (7.25 * MIN) / 20);
});
