/** services/clock — the device → server clock offset every `server_time` updates. */
import {
  serverClockOffsetMs,
  serverNow,
  setServerTime,
} from "@/services/clock";

const DEVICE_NOW = Date.parse("2026-10-03T19:00:00.000Z");

beforeEach(() => {
  jest.useFakeTimers({ now: DEVICE_NOW });
  setServerTime(new Date(DEVICE_NOW).toISOString(), DEVICE_NOW); // offset 0
});
afterEach(() => jest.useRealTimers());

describe("setServerTime", () => {
  it("a device clock 5 min slow gives an offset of +5 min, measured at receivedAtMs", () => {
    setServerTime("2026-10-03T19:05:00.000Z", DEVICE_NOW);
    expect(serverClockOffsetMs()).toBe(300_000);
  });

  it("a device clock 90 s fast gives a negative offset", () => {
    setServerTime("2026-10-03T18:58:30.000Z", DEVICE_NOW);
    expect(serverClockOffsetMs()).toBe(-90_000);
  });

  it("uses the response's receipt time, not the time it is recorded", () => {
    // The response left the server at 19:05:00 and arrived 2 s later on the device clock.
    setServerTime("2026-10-03T19:05:00.000Z", DEVICE_NOW + 2_000);
    expect(serverClockOffsetMs()).toBe(298_000);
  });

  it("defaults receivedAtMs to the device clock", () => {
    setServerTime("2026-10-03T19:00:07.000Z");
    expect(serverClockOffsetMs()).toBe(7_000);
  });

  it("honours an explicit UTC offset in the server time", () => {
    setServerTime("2026-10-03T21:01:00+02:00", DEVICE_NOW);
    expect(serverClockOffsetMs()).toBe(60_000);
  });

  it.each(["", "not a date", "2026-13-45T99:00:00Z"])(
    "ignores an unparseable server time (%p) and keeps the last offset",
    (bad) => {
      setServerTime("2026-10-03T19:05:00.000Z", DEVICE_NOW);
      setServerTime(bad, DEVICE_NOW);
      expect(serverClockOffsetMs()).toBe(300_000);
    },
  );
});

describe("serverNow", () => {
  it("is the device clock plus the offset", () => {
    setServerTime("2026-10-03T19:05:00.000Z", DEVICE_NOW);
    expect(serverNow()).toBe(Date.parse("2026-10-03T19:05:00.000Z"));
  });

  it("keeps the offset as the device clock moves on", () => {
    setServerTime("2026-10-03T19:05:00.000Z", DEVICE_NOW);
    jest.advanceTimersByTime(60_000);
    expect(serverNow()).toBe(Date.parse("2026-10-03T19:06:00.000Z"));
  });

  it("equals the device clock when the clocks agree", () => {
    expect(serverClockOffsetMs()).toBe(0);
    expect(serverNow()).toBe(DEVICE_NOW);
  });
});
