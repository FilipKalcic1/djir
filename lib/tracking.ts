/**
 * lib/tracking.ts — where a ride is, as a pure function of the ride and a clock
 * (ADR-009).
 *
 * A ride row stores when the driver sets off (`paid_at` for a ride now,
 * `scheduled_at − pickup_minutes` for a scheduled one) and how long each leg
 * takes. Everything the tracker shows — the phase, the countdown, where the car
 * is — derives from that and the current time. No status column, no background
 * job: reopening the app after a crash simply recomputes the same answer.
 *
 * The car's position comes from a `PositionSource` (ADR-010). Djir has no
 * driver app, so the shipped source simulates the drive along the route; a real
 * GPS feed would implement the same signature.
 */

import { LatLng, pointAlong } from "@/lib/geo";
import { driverStartFor } from "@/lib/map";
import { dayLabel } from "@/lib/schedule";
import { formatEur, placeName } from "@/lib/utils";
import { formatPickupTime } from "@/lib/zagreb-time";
import { Ride } from "@/types/type";

/** How long the driver waits at the pickup: the "arrived" phase. */
export const BOARDING_MINUTES = 1;
const MS_PER_MINUTE = 60_000;

/**
 * The demo speed-up from EXPO_PUBLIC_TRACKING_SPEEDUP: honoured only in
 * development builds, and only when it is a finite number ≥ 1.
 */
export function trackingSpeedup(
  raw: string | undefined,
  isDev: boolean,
): number {
  const value = Number(raw);
  return isDev && raw !== "" && Number.isFinite(value) && value >= 1
    ? value
    : 1;
}

/** Where a ride is: its phase on the timeline (S4–S9). */
export type RidePhase =
  "scheduled" | "en_route" | "arrived" | "on_trip" | "completed" | "cancelled";

/** When a ride's driver sets off and how long each leg takes (ADR-009). */
export interface RideTimeline {
  departAtMs: number;
  pickupMinutes: number;
  tripMinutes: number;
  isScheduled: boolean;
  cancelledAtMs: number | null;
}

/** The phase at one instant, with the countdown and progress through the leg. */
export interface PhaseState {
  phase: RidePhase;
  /** Minutes until the next stop (simulated minutes once the driver moves). */
  minutesLeft: number;
  /** Progress through the current leg, 0..1. */
  legProgress: number;
}

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/**
 * The ride's timeline, or null if it cannot be tracked (booked before v1.1,
 * unpaid, or malformed). A ride now departs when its payment succeeded
 * (`paid_at`) — not when it was reserved, so a slow 3-D Secure challenge never
 * eats into the "Arriving in" countdown. A scheduled ride departs
 * `pickup_minutes` before its slot.
 */
export function timelineFor(ride: Ride): RideTimeline | null {
  const pickupMinutes = ride.pickup_minutes;
  const tripMinutes = ride.ride_time;
  const paidMs = ride.paid_at === null ? null : Date.parse(ride.paid_at);
  const scheduledMs =
    ride.scheduled_at === null ? null : Date.parse(ride.scheduled_at);
  const cancelledMs =
    ride.cancelled_at === null ? null : Date.parse(ride.cancelled_at);
  if (
    !finite(pickupMinutes) ||
    pickupMinutes < 1 ||
    !finite(tripMinutes) ||
    tripMinutes < 1 ||
    (scheduledMs === null ? !finite(paidMs) : !finite(scheduledMs))
  ) {
    return null;
  }
  return {
    departAtMs:
      scheduledMs === null
        ? (paidMs as number)
        : scheduledMs - pickupMinutes * MS_PER_MINUTE,
    pickupMinutes,
    tripMinutes,
    isScheduled: scheduledMs !== null,
    cancelledAtMs: finite(cancelledMs) ? cancelledMs : null,
  };
}

/**
 * The phase at `nowMs`. Windows are half-open [start, end). `speedup`
 * compresses the drive for demos; the wait before a scheduled departure is
 * always real time. A ride now never shows "scheduled", even if the device
 * clock lags the server's.
 */
export function phaseAt(
  t: RideTimeline,
  nowMs: number,
  speedup = 1,
): PhaseState {
  if (t.cancelledAtMs !== null) {
    return { phase: "cancelled", minutesLeft: 0, legProgress: 1 };
  }
  const realElapsed = (nowMs - t.departAtMs) / MS_PER_MINUTE;
  if (realElapsed < 0 && t.isScheduled) {
    return { phase: "scheduled", minutesLeft: -realElapsed, legProgress: 0 };
  }
  const elapsed = Math.max(0, realElapsed) * speedup;
  const arrivedAt = t.pickupMinutes;
  const boardedAt = arrivedAt + BOARDING_MINUTES;
  const endsAt = boardedAt + t.tripMinutes;

  if (elapsed < arrivedAt) {
    return {
      phase: "en_route",
      minutesLeft: arrivedAt - elapsed,
      legProgress: elapsed / arrivedAt,
    };
  }
  if (elapsed < boardedAt) {
    return {
      phase: "arrived",
      minutesLeft: 0,
      legProgress: (elapsed - arrivedAt) / BOARDING_MINUTES,
    };
  }
  if (elapsed < endsAt) {
    return {
      phase: "on_trip",
      minutesLeft: endsAt - elapsed,
      legProgress: (elapsed - boardedAt) / t.tripMinutes,
    };
  }
  return { phase: "completed", minutesLeft: 0, legProgress: 1 };
}

/** A ride that can be tracked: its timeline and the three points of its route. */
export interface TrackedRide {
  ride: Ride;
  timeline: RideTimeline;
  pickup: LatLng;
  destination: LatLng;
  driverStart: LatLng;
}

/**
 * A ride from history that has no timeline (booked before v1.1, T7): it is
 * over, so the tracker shows it as completed at the time it was booked.
 */
export function pastRide(ride: Ride): {
  timeline: RideTimeline;
  phase: PhaseState;
} {
  return {
    timeline: {
      departAtMs: Date.parse(ride.created_at),
      pickupMinutes: 0,
      tripMinutes: ride.ride_time,
      isScheduled: false,
      cancelledAtMs: null,
    },
    phase: { phase: "completed", minutesLeft: 0, legProgress: 1 },
  };
}

/**
 * The ride with its timeline, pickup, destination and the driver's start (the
 * spot the booking map showed, R12) — or null when it has no timeline or a
 * coordinate is missing, and so cannot be tracked.
 */
export function trackedRideFrom(ride: Ride): TrackedRide | null {
  const timeline = timelineFor(ride);
  const coords = [
    ride.origin_latitude,
    ride.origin_longitude,
    ride.destination_latitude,
    ride.destination_longitude,
  ];
  if (!timeline || !coords.every(finite)) return null;
  const pickup = {
    latitude: ride.origin_latitude,
    longitude: ride.origin_longitude,
  };
  return {
    ride,
    timeline,
    pickup,
    destination: {
      latitude: ride.destination_latitude,
      longitude: ride.destination_longitude,
    },
    driverStart: driverStartFor(ride.driver.driver_id, pickup),
  };
}

/** The two legs of a ride: driver → pickup, pickup → destination. */
export interface RouteLegs {
  toPickup: LatLng[];
  toDestination: LatLng[];
}

/** The route: straight legs (deterministic, no Directions key needed — ADR-010). */
export function straightLegs(ride: TrackedRide): RouteLegs {
  return {
    toPickup: [ride.driverStart, ride.pickup],
    toDestination: [ride.pickup, ride.destination],
  };
}

/** The phase plus where the car is and which way it faces. */
export interface TrackingSnapshot extends PhaseState {
  car: LatLng;
  headingDeg: number;
}

/** Where the car is at `nowMs`. The seam a real GPS feed would implement. */
export type PositionSource = (
  ride: TrackedRide,
  legs: RouteLegs,
  nowMs: number,
) => TrackingSnapshot;

/** The shipped PositionSource: the driver follows the route on schedule. */
export function simulatedPosition(speedup = 1): PositionSource {
  return (ride, legs, nowMs) => {
    const state = phaseAt(ride.timeline, nowMs, speedup);
    switch (state.phase) {
      case "en_route": {
        const { point, headingDeg } = pointAlong(
          legs.toPickup,
          state.legProgress,
        );
        return { ...state, car: point, headingDeg };
      }
      case "arrived":
        return {
          ...state,
          car: ride.pickup,
          headingDeg: pointAlong(legs.toPickup, 1).headingDeg,
        };
      case "on_trip": {
        const { point, headingDeg } = pointAlong(
          legs.toDestination,
          state.legProgress,
        );
        return { ...state, car: point, headingDeg };
      }
      case "completed":
        return {
          ...state,
          car: ride.destination,
          headingDeg: pointAlong(legs.toDestination, 1).headingDeg,
        };
      default: // scheduled, cancelled: the car waits where it starts
        return {
          ...state,
          car: ride.driverStart,
          headingDeg: pointAlong(legs.toPickup, 0).headingDeg,
        };
    }
  };
}

/** The tracking headline in three parts; the accent is coloured. */
export interface Headline {
  lead: string;
  accent: string;
  tail: string;
}

/**
 * A countdown in whole minutes: rounded up, like every ETA, and never below 1
 * ("1 Min", never "0 Mins": T2b, T3). The tracker and the Home banner share it.
 */
export function countdownMinutes(minutesLeft: number): number {
  return Math.max(1, Math.ceil(minutesLeft));
}

/**
 * In the pickup leg's last minute the driver is arriving "now", on the tracker
 * (T2) and the Home banner (B1d) alike.
 */
export function isArrivingNow(state: PhaseState): boolean {
  return state.phase === "en_route" && state.minutesLeft < 1;
}

const minutesText = (minutesLeft: number) => {
  const n = countdownMinutes(minutesLeft);
  return `${n} ${n === 1 ? "Min" : "Mins"}`;
};

/** The tracking sheet's headline (Figma 14: the accent is green). */
export function trackingHeadline(
  state: PhaseState,
  timeline: RideTimeline,
): Headline {
  switch (state.phase) {
    case "scheduled":
      return {
        lead: "Pickup at ",
        accent: formatPickupTime(
          timeline.departAtMs + timeline.pickupMinutes * MS_PER_MINUTE,
        ),
        tail: "",
      };
    case "en_route":
      return isArrivingNow(state)
        ? { lead: "Arriving ", accent: "now", tail: "" }
        : {
            lead: "Arriving in ",
            accent: minutesText(state.minutesLeft),
            tail: "",
          };
    case "arrived":
      return { lead: "Your driver has ", accent: "arrived", tail: "" };
    case "on_trip":
      return {
        lead: "",
        accent: minutesText(state.minutesLeft),
        tail: " to destination",
      };
    case "completed":
      return { lead: "Ride ", accent: "complete", tail: "" };
    case "cancelled":
      return { lead: "Ride ", accent: "cancelled", tail: "" };
  }
}

/** The line under the headline, or null (states S4–S9 of the build plan). */
export function trackingDetail(
  state: PhaseState,
  ride: Ride,
  timeline: RideTimeline,
  nowMs: number,
): string | null {
  const fare = formatEur(ride.fare_price);
  switch (state.phase) {
    case "scheduled":
      // The day of the set-off, not of the pickup: for a 00:00 pickup the
      // driver sets off (and free cancellation ends) the evening before (T12).
      return `${dayLabel(timeline.departAtMs, nowMs)} · your driver sets off at ${formatPickupTime(timeline.departAtMs)} · free cancellation until then`;
    case "arrived":
      return "Meet them at the pickup point";
    case "completed":
      return `You've reached ${placeName(ride.destination_address)} · Paid ${fare}`;
    case "cancelled":
      return `Refund of ${fare} to your card · 5–10 days`;
    default:
      return null;
  }
}
