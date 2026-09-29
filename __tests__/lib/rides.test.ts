import {
  effectivePickupMs,
  formatRideTime,
  rideStatus,
  sortRidesForHistory,
  trackRideHref,
} from "@/lib/rides";

import { makeRide, MIN } from "../helpers/rides";

const NOW = Date.parse("2026-10-03T19:05:00Z");

const live = makeRide({ ride_id: 1, paid_at: "2026-10-03T19:00:00.000Z" });
const upcomingSoon = makeRide({
  ride_id: 2,
  scheduled_at: "2026-10-04T06:00:00.000Z",
});
const upcomingLater = makeRide({
  ride_id: 3,
  scheduled_at: "2026-10-06T06:00:00.000Z",
});
const pastRecent = makeRide({
  ride_id: 4,
  paid_at: "2026-10-02T10:00:00.000Z",
});
const pastOld = makeRide({ ride_id: 5, paid_at: "2026-09-01T10:00:00.000Z" });
const cancelled = makeRide({
  ride_id: 6,
  scheduled_at: "2026-10-05T06:00:00.000Z",
  cancelled_at: "2026-10-03T12:00:00.000Z",
  payment_status: "refunded",
});
// Booked before v1.1: no pickup time, no paid_at.
const legacy = makeRide({
  ride_id: 7,
  pickup_minutes: null,
  paid_at: null,
  created_at: "2026-10-01T10:00:00.000Z",
});

describe("rideStatus", () => {
  it.each([
    [
      "a ride on its way",
      live,
      { badge: "live", canTrack: true, canCancel: false },
    ],
    [
      "a scheduled ride",
      upcomingSoon,
      { badge: "upcoming", canTrack: false, canCancel: true },
    ],
    [
      "a finished ride",
      pastRecent,
      { badge: null, canTrack: false, canCancel: false },
    ],
    [
      "a cancelled ride",
      cancelled,
      { badge: "cancelled", canTrack: false, canCancel: false },
    ],
    [
      "a ride from before v1.1",
      legacy,
      { badge: null, canTrack: false, canCancel: false },
    ],
  ])("%s", (_, ride, expected) => {
    expect(rideStatus(ride, NOW)).toMatchObject(expected);
  });

  it("flips an upcoming ride to live when the driver sets off", () => {
    const departAt = Date.parse("2026-10-04T06:00:00Z") - 7 * MIN;
    expect(rideStatus(upcomingSoon, departAt - 1).badge).toBe("upcoming");
    expect(rideStatus(upcomingSoon, departAt).badge).toBe("live");
  });
});

describe("sortRidesForHistory", () => {
  it("puts Live first, Upcoming soonest-first, then the rest newest-first", () => {
    const shuffled = [
      pastOld,
      upcomingLater,
      cancelled,
      live,
      legacy,
      upcomingSoon,
      pastRecent,
    ];
    expect(sortRidesForHistory(shuffled, NOW).map((r) => r.ride_id)).toEqual([
      1, 2, 3, 6, 4, 7, 5,
    ]);
  });

  it("returns a new array and leaves the input alone", () => {
    const input = [pastOld, live];
    const sorted = sortRidesForHistory(input, NOW);
    expect(sorted).not.toBe(input);
    expect(input.map((r) => r.ride_id)).toEqual([5, 1]);
  });
});

describe("effectivePickupMs / formatRideTime", () => {
  it("R46: uses the slot for scheduled rides, payment + approach for rides now", () => {
    expect(effectivePickupMs(upcomingSoon)).toBe(
      Date.parse("2026-10-04T06:00:00Z"),
    );
    expect(effectivePickupMs(live)).toBe(Date.parse("2026-10-03T19:07:00Z"));
    expect(effectivePickupMs(legacy)).toBe(Date.parse("2026-10-01T10:00:00Z"));
  });

  it("R46: formats the pickup on the Zagreb clock", () => {
    expect(formatRideTime(upcomingSoon)).toBe("4 Oct 2026, 08:00");
  });

  it("K12 H2: a pickup in the repeated autumn hour keeps its zone in history", () => {
    const repeated = makeRide({ scheduled_at: "2026-10-25T01:15:00.000Z" });
    expect(formatRideTime(repeated)).toBe("25 Oct 2026, 02:15 CET");
  });
});

describe("trackRideHref (WP3 entry points)", () => {
  it("H1 H2 B1a B2 N5: every way into a ride pushes /(root)/track-ride with its id as a string", () => {
    expect(trackRideHref(42)).toEqual({
      pathname: "/(root)/track-ride",
      params: { rideId: "42" },
    });
  });
});
