import { distanceKm } from "@/lib/geo";
import { driverStartFor } from "@/lib/map";
import { pickupMinutesFor } from "@/lib/pricing";
import {
  countdownMinutes,
  isArrivingNow,
  pastRide,
  phaseAt,
  RideTimeline,
  simulatedPosition,
  straightLegs,
  timelineFor,
  trackedRideFrom,
  trackingDetail,
  trackingHeadline,
  trackingSpeedup,
} from "@/lib/tracking";
import { Ride } from "@/types/type";

import { makeRide, MIN } from "../helpers/rides";

const DEPART = Date.parse("2026-10-03T19:00:00Z");
const nowRide: RideTimeline = {
  departAtMs: DEPART,
  pickupMinutes: 7,
  tripMinutes: 12,
  isScheduled: false,
  cancelledAtMs: null,
};

describe("phaseAt — half-open windows [start, end)", () => {
  it.each([
    [0, "en_route", 7],
    [6.99, "en_route", 0.01],
    [7, "arrived", 0],
    [7.99, "arrived", 0],
    [8, "on_trip", 12],
    [19.99, "on_trip", 0.01],
    [20, "completed", 0],
    [600, "completed", 0],
  ])("T1 T3: %p min after departure → %s", (minutes, phase, left) => {
    const state = phaseAt(nowRide, DEPART + (minutes as number) * MIN);
    expect(state.phase).toBe(phase);
    expect(state.minutesLeft).toBeCloseTo(left as number, 5);
  });

  it("T4: never shows 'scheduled' for a ride now, even if the device clock lags", () => {
    expect(phaseAt(nowRide, DEPART - 3 * MIN)).toMatchObject({
      phase: "en_route",
      minutesLeft: 7,
    });
  });

  it("T5: counts real minutes down to a scheduled departure", () => {
    const scheduled = { ...nowRide, isScheduled: true };
    expect(phaseAt(scheduled, DEPART - 90 * MIN, 20)).toMatchObject({
      phase: "scheduled",
      minutesLeft: 90,
    });
  });

  it("compresses the drive, not the wait, when sped up", () => {
    expect(phaseAt(nowRide, DEPART + 30_000, 20).phase).toBe("on_trip"); // 10 simulated min
  });

  it("reports progress through the current leg", () => {
    expect(phaseAt(nowRide, DEPART + 3.5 * MIN).legProgress).toBeCloseTo(0.5);
    expect(phaseAt(nowRide, DEPART + 14 * MIN).legProgress).toBeCloseTo(0.5);
  });

  it("is 'cancelled' once cancelled, whatever the clock says", () => {
    const cancelled = { ...nowRide, cancelledAtMs: DEPART - MIN };
    expect(phaseAt(cancelled, DEPART + 5 * MIN).phase).toBe("cancelled");
  });

  it("T11: a cancelled scheduled ride stays cancelled at every later clock, never en_route after its slot", () => {
    const t = timelineFor(
      makeRide({
        scheduled_at: "2026-10-04T06:00:00.000Z",
        cancelled_at: "2026-10-03T19:00:00.000Z",
        payment_status: "refunded",
      }),
    )!;
    const clocks = [-MIN, 0, 7 * MIN, 8 * MIN, 20 * MIN, 24 * 60 * MIN].map(
      (offset) => t.departAtMs + offset,
    );
    expect(clocks.map((nowMs) => phaseAt(t, nowMs, 20))).toEqual(
      clocks.map(() => ({
        phase: "cancelled",
        minutesLeft: 0,
        legProgress: 1,
      })),
    );
  });
});

describe("timelineFor", () => {
  it("departs when the payment succeeded for a ride now — not when it was reserved", () => {
    // Reserved 18:59, 3-D Secure took a minute, paid 19:00: the countdown starts at 19:00.
    expect(timelineFor(makeRide())).toEqual(nowRide);
  });

  it("departs pickup_minutes before the slot for a scheduled ride", () => {
    const ride = makeRide({ scheduled_at: "2026-10-03T21:30:00.000Z" });
    expect(timelineFor(ride)).toMatchObject({
      departAtMs: Date.parse("2026-10-03T21:23:00Z"),
      isScheduled: true,
    });
  });

  it.each([
    ["a ride booked before v1.1", { pickup_minutes: null }],
    ["a zero pickup time", { pickup_minutes: 0 }],
    ["a missing trip time", { ride_time: NaN }],
    ["an unpaid ride now", { paid_at: null }],
    ["an unparseable payment time", { paid_at: "yesterday" }],
    ["an unparseable slot", { scheduled_at: "soon" }],
  ])("is null for %s", (_, overrides) => {
    expect(timelineFor(makeRide(overrides as never))).toBeNull();
  });
});

describe("trackedRideFrom", () => {
  it("starts the car where the booking map showed that driver", () => {
    const tracked = trackedRideFrom(makeRide())!;
    expect(tracked.driverStart).toEqual(
      driverStartFor(3, { latitude: 45.8, longitude: 15.945 }),
    );
  });

  it("is null when a coordinate is missing", () => {
    expect(trackedRideFrom(makeRide({ origin_latitude: NaN }))).toBeNull();
  });
});

describe("the car you picked is the car you track (UX invariant)", () => {
  it("R14: DriverCard minutes = stored pickup_minutes = first 'Arriving in'", () => {
    const pickup = { latitude: 45.8, longitude: 15.945 };
    const shownOnCard = pickupMinutesFor(driverStartFor(3, pickup), pickup);
    const ride = makeRide({ pickup_minutes: shownOnCard });
    const t = timelineFor(ride)!;
    const headline = trackingHeadline(phaseAt(t, t.departAtMs), t);
    expect(headline.accent).toBe(`${shownOnCard} Mins`);
  });
});

describe("simulatedPosition", () => {
  const tracked = trackedRideFrom(makeRide())!;
  const legs = straightLegs(tracked);
  const position = simulatedPosition();

  it("waits at the start before a scheduled departure", () => {
    const scheduled = trackedRideFrom(
      makeRide({ scheduled_at: "2026-10-03T23:00:00.000Z" }),
    )!;
    expect(position(scheduled, straightLegs(scheduled), DEPART).car).toEqual(
      scheduled.driverStart,
    );
  });

  it("drives from the start to the pickup, closing in monotonically", () => {
    const gaps = [0, 2, 4, 6].map((m) =>
      distanceKm(position(tracked, legs, DEPART + m * MIN).car, tracked.pickup),
    );
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
    expect(gaps[0]).toBeCloseTo(
      distanceKm(tracked.driverStart, tracked.pickup),
    );
  });

  it("waits at the pickup, then drives to the destination", () => {
    expect(position(tracked, legs, DEPART + 7.5 * MIN).car).toEqual(
      tracked.pickup,
    );
    const midTrip = position(tracked, legs, DEPART + 14 * MIN);
    expect(distanceKm(midTrip.car, tracked.pickup)).toBeCloseTo(
      distanceKm(midTrip.car, tracked.destination),
      2,
    );
    expect(position(tracked, legs, DEPART + 25 * MIN).car).toEqual(
      tracked.destination,
    );
  });

  it("faces along the road (east-north-east from Tresnjevka to the centre)", () => {
    const { headingDeg } = position(tracked, legs, DEPART + 14 * MIN);
    expect(headingDeg).toBeGreaterThan(60);
    expect(headingDeg).toBeLessThan(75);
  });

  it("T8: keeps the car at its start when the ride is cancelled", () => {
    const cancelled = trackedRideFrom(
      makeRide({ cancelled_at: "2026-10-03T18:00:00.000Z" }),
    )!;
    expect(position(cancelled, straightLegs(cancelled), DEPART).car).toEqual(
      cancelled.driverStart,
    );
  });

  it("handles a zero-length route: the car stays put, facing north", () => {
    const here = { latitude: 45.8, longitude: 15.945 };
    const snap = position(
      tracked,
      { toPickup: [here, here], toDestination: [here] },
      DEPART + MIN,
    );
    expect(snap.car).toEqual(here);
    expect(snap.headingDeg).toBe(0);
  });
});

describe("trackingHeadline (the copy table)", () => {
  const headline = (minutes: number, t = nowRide) =>
    trackingHeadline(phaseAt(t, DEPART + minutes * MIN), t);
  const text = (h: ReturnType<typeof headline>) => h.lead + h.accent + h.tail;

  it.each([
    [0, "Arriving in 7 Mins"],
    [5.5, "Arriving in 2 Mins"],
    [5.99, "Arriving in 2 Mins"],
    [6.01, "Arriving now"],
    [7, "Your driver has arrived"],
    [8, "12 Mins to destination"],
    [19.5, "1 Min to destination"],
    [20, "Ride complete"],
  ])("T1 T2 T3: %p min → %s", (minutes, expected) => {
    expect(text(headline(minutes))).toBe(expected);
  });

  it("T2b: says 1 Min at +6 min exactly, not 1 Mins (and never 0 Mins)", () => {
    expect(headline(5.2).accent).toBe("2 Mins");
    expect(headline(6).accent).toBe("1 Min");
  });

  it("S4: shows the pickup time (Zagreb) while scheduled", () => {
    const scheduled = timelineFor(
      makeRide({ scheduled_at: "2026-10-03T21:30:00.000Z" }),
    )!;
    expect(text(trackingHeadline(phaseAt(scheduled, DEPART), scheduled))).toBe(
      "Pickup at 23:30",
    );
  });

  it("T8: says the ride was cancelled", () => {
    const cancelled = { ...nowRide, cancelledAtMs: DEPART };
    expect(text(headline(1, cancelled))).toBe("Ride cancelled");
  });

  it("K12: a pickup in the repeated autumn hour names its zone", () => {
    const repeated = timelineFor(
      makeRide({ scheduled_at: "2026-10-25T01:15:00.000Z" }),
    )!;
    expect(text(trackingHeadline(phaseAt(repeated, DEPART), repeated))).toBe(
      "Pickup at 02:15 CET",
    );
  });
});

describe("the shared countdown (tracker and Home banner)", () => {
  it.each([
    [7, 7],
    [6.5, 7], // ETAs round up
    [1.01, 2],
    [1, 1],
    [0.01, 1], // never 0
    [0, 1],
  ])("T2b T3: %p minutes left counts as %p", (minutesLeft, shown) => {
    expect(countdownMinutes(minutesLeft)).toBe(shown);
  });

  it.each([
    ["+6 min exactly (1 min left)", 6, false],
    ["+6.01 min (under a minute left)", 6.01, true],
    ["+6.99 min", 6.99, true],
    ["arrived", 7, false],
    ["the trip's last half minute", 19.5, false],
  ])("T2 B1d: %s → arriving now: %p", (_, minutes, now) => {
    expect(isArrivingNow(phaseAt(nowRide, DEPART + minutes * MIN))).toBe(now);
  });
});

describe("trackingSpeedup (T6)", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", " "],
    ["not a number", "abc"],
    ["zero", "0"],
    ["negative", "-1"],
    ["below 1", "0.5"],
    ["infinite", "Infinity"],
  ])("T6: %s (%p) in a dev build → 1", (_, raw) => {
    expect(trackingSpeedup(raw, true)).toBe(1);
  });

  it('T6: "20" in a dev build → 20', () => {
    expect(trackingSpeedup("20", true)).toBe(20);
  });

  it('T6: "20" in a production build → 1', () => {
    expect(trackingSpeedup("20", false)).toBe(1);
  });
});

describe("trackingDetail (the line under the headline)", () => {
  const detail = (ride: Ride, nowMs: number) => {
    const t = timelineFor(ride)!;
    return trackingDetail(phaseAt(t, nowMs), ride, t, nowMs);
  };

  it("S4: names the day, when the driver sets off, and the free-cancellation window", () => {
    // Now: Sat 3 Oct, 21:00 in Zagreb. Pickup: Sun 4 Oct, 08:00 (06:00Z), 7 min out.
    const ride = makeRide({ scheduled_at: "2026-10-04T06:00:00.000Z" });
    expect(detail(ride, DEPART)).toBe(
      "Tomorrow · your driver sets off at 07:53 · free cancellation until then",
    );
  });

  it("K12: names the zone of a departure and pickup in the repeated autumn hour", () => {
    // Pickup 02:15 CET (01:15Z); Michael sets off 7 min earlier, 02:08 CET.
    const ride = makeRide({ scheduled_at: "2026-10-25T01:15:00.000Z" });
    expect(detail(ride, Date.parse("2026-10-24T18:00:00Z"))).toBe(
      "Tomorrow · your driver sets off at 02:08 CET · free cancellation until then",
    );
  });

  it('S4: says "Today" for a pickup later the same Zagreb day', () => {
    const ride = makeRide({ scheduled_at: "2026-10-03T21:30:00.000Z" });
    expect(detail(ride, DEPART)).toBe(
      "Today · your driver sets off at 23:23 · free cancellation until then",
    );
  });

  it("T12: a 00:00 pickup's driver sets off the evening before, so the detail names that day — the day free cancellation ends", () => {
    // Now: Sat 3 Oct, 21:00 in Zagreb. Pickup: Sun 4 Oct, 00:00 (22:00Z); set-off 23:53 on Saturday.
    const ride = makeRide({ scheduled_at: "2026-10-03T22:00:00.000Z" });
    expect(detail(ride, DEPART)).toBe(
      "Today · your driver sets off at 23:53 · free cancellation until then",
    );
  });

  it("T12: seen the day before, the same ride sets off 'Tomorrow', not two days on", () => {
    const ride = makeRide({ scheduled_at: "2026-10-03T22:00:00.000Z" });
    expect(detail(ride, DEPART - 24 * 60 * MIN)).toBe(
      "Tomorrow · your driver sets off at 23:53 · free cancellation until then",
    );
  });

  it("S5: has no detail line while the driver is on the way", () => {
    expect(detail(makeRide(), DEPART + 3 * MIN)).toBeNull();
  });

  it("S6: tells the rider where to meet the driver", () => {
    expect(detail(makeRide(), DEPART + 7 * MIN)).toBe(
      "Meet them at the pickup point",
    );
  });

  it("S7: has no detail line during the trip", () => {
    expect(detail(makeRide(), DEPART + 8 * MIN)).toBeNull();
  });

  it("S8: names the destination (up to its first comma) and the fare paid", () => {
    expect(detail(makeRide(), DEPART + 20 * MIN)).toBe(
      "You've reached Trg bana Jelačića · Paid €9.74",
    );
    expect(
      detail(
        makeRide({ destination_address: "Zagreb Airport", fare_price: 24.5 }),
        DEPART + 20 * MIN,
      ),
    ).toBe("You've reached Zagreb Airport · Paid €24.50");
  });

  it("S9: promises the refund of the fare to the card", () => {
    const ride = makeRide({
      scheduled_at: "2026-10-04T06:00:00.000Z",
      cancelled_at: "2026-10-03T18:00:00.000Z",
      payment_status: "refunded",
    });
    expect(detail(ride, DEPART)).toBe(
      "Refund of €9.74 to your card · 5–10 days",
    );
  });
});

describe("pastRide (T7)", () => {
  it("T7: a ride booked before v1.1 reads as completed, timed from its booking", () => {
    const legacy = makeRide({ pickup_minutes: null, paid_at: null });
    const { timeline, phase } = pastRide(legacy);
    expect(phase).toEqual({
      phase: "completed",
      minutesLeft: 0,
      legProgress: 1,
    });
    expect(timeline).toEqual({
      departAtMs: Date.parse(legacy.created_at),
      pickupMinutes: 0,
      tripMinutes: 12,
      isScheduled: false,
      cancelledAtMs: null,
    });
    expect(trackingHeadline(phase, timeline)).toEqual({
      lead: "Ride ",
      accent: "complete",
      tail: "",
    });
  });
});
