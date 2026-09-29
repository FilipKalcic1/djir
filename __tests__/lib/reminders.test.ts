import {
  desiredReminders,
  REMINDER_LEAD_MINUTES,
  reminderFor,
  reminderId,
} from "@/lib/reminders";

import { makeRide, MIN } from "../helpers/rides";

// Pickup Thu 1 Oct 2026 at 08:00 in Zagreb (06:00Z); Michael needs 7 minutes
// to get there, so he sets off at 07:53 (05:53Z).
const scheduled = makeRide({
  ride_id: 42,
  scheduled_at: "2026-10-01T06:00:00.000Z",
});
const DEPART = Date.parse("2026-10-01T05:53:00Z");
const REMIND_AT = DEPART - 10 * MIN;
const NOW = Date.parse("2026-09-30T18:00:00Z");

describe("reminderFor", () => {
  it("N1: a scheduled ride gets one reminder, 10 min before the driver sets off, with Zagreb clock times", () => {
    expect(REMINDER_LEAD_MINUTES).toBe(10);
    expect(reminderFor(scheduled, NOW)).toEqual({
      id: "ride-42",
      rideId: 42,
      atMs: REMIND_AT,
      title: "Your ride is almost here",
      body: "Michael sets off at 07:53 for your 08:00 pickup.",
    });
  });

  it("N1: reads the times on the Zagreb clock in winter too (CET)", () => {
    // Tue 1 Dec 2026, 08:00 CET is 07:00Z.
    const winter = makeRide({ scheduled_at: "2026-12-01T07:00:00.000Z" });
    expect(reminderFor(winter, NOW)).toMatchObject({
      atMs: Date.parse("2026-12-01T06:43:00Z"),
      body: "Michael sets off at 07:53 for your 08:00 pickup.",
    });
  });

  it("N1 K12: names the zone when a time falls in the repeated autumn hour", () => {
    // Pickup 02:05 CET (01:05Z); Michael sets off at 00:58Z, still 02:58 CEST.
    const repeated = makeRide({ scheduled_at: "2026-10-25T01:05:00.000Z" });
    expect(reminderFor(repeated, NOW)).toMatchObject({
      atMs: Date.parse("2026-10-25T00:48:00Z"),
      body: "Michael sets off at 02:58 CEST for your 02:05 CET pickup.",
    });
  });

  it("N1: is still scheduled a moment before its time", () => {
    expect(reminderFor(scheduled, REMIND_AT - 1)?.atMs).toBe(REMIND_AT);
  });

  it.each([
    ["exactly at the reminder time", REMIND_AT],
    ["5 min before the driver sets off", DEPART - 5 * MIN],
    ["after the driver set off", DEPART + MIN],
  ])("N2: none once the reminder time has passed — %s", (_, nowMs) => {
    expect(reminderFor(scheduled, nowMs)).toBeNull();
  });

  it.each([
    ["a ride booked for now", makeRide()],
    [
      "a cancelled scheduled ride",
      makeRide({
        scheduled_at: "2026-10-01T06:00:00.000Z",
        cancelled_at: "2026-09-30T17:00:00.000Z",
        payment_status: "refunded",
      }),
    ],
    [
      "a ride without a pickup time (booked before v1.1)",
      makeRide({
        scheduled_at: "2026-10-01T06:00:00.000Z",
        pickup_minutes: null,
      }),
    ],
  ])("none for %s", (_, ride) => {
    expect(reminderFor(ride, NOW)).toBeNull();
  });
});

describe("reminderId", () => {
  it("is 'ride-{id}', so a cancel or sign-out can find the reminder again", () => {
    expect(reminderId(42)).toBe("ride-42");
    expect(reminderId(42)).toBe(reminderFor(scheduled, NOW)!.id);
  });
});

describe("desiredReminders", () => {
  it("N7: a history calls for one reminder per upcoming scheduled ride, in history order", () => {
    const rides = [
      makeRide({ ride_id: 1 }), // a ride now
      scheduled,
      makeRide({ ride_id: 43, scheduled_at: "2026-10-02T06:00:00.000Z" }),
      makeRide({
        ride_id: 44,
        scheduled_at: "2026-10-02T09:00:00.000Z",
        cancelled_at: "2026-09-30T12:00:00.000Z",
        payment_status: "refunded",
      }),
      makeRide({ ride_id: 45, scheduled_at: "2026-09-30T18:15:00.000Z" }), // reminder was due 17:58Z
    ];
    expect(
      desiredReminders(rides, NOW).map((r) => [r.id, r.atMs, r.body]),
    ).toEqual([
      [
        "ride-42",
        REMIND_AT,
        "Michael sets off at 07:53 for your 08:00 pickup.",
      ],
      [
        "ride-43",
        Date.parse("2026-10-02T05:43:00Z"),
        "Michael sets off at 07:53 for your 08:00 pickup.",
      ],
    ]);
  });

  it("is empty for an empty history", () => {
    expect(desiredReminders([], NOW)).toEqual([]);
  });
});
