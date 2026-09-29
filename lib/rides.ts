/**
 * lib/rides.ts — how ride history is ordered and badged.
 *
 * Badges: Live (the driver is on the way or you are riding), Upcoming
 * (scheduled, not yet started), Cancelled. Completed rides carry no badge, as
 * in the Figma history card. Live rides come first, then Upcoming (soonest
 * first), then everything else (most recent first) — so Home's top five always
 * include the ride that matters right now.
 */

import { phaseAt, RidePhase, timelineFor } from "@/lib/tracking";
import { formatZagrebDateTime } from "@/lib/zagreb-time";
import { Ride } from "@/types/type";

/** The history badge: Live, Upcoming, Cancelled, or none (completed, legacy). */
export type RideBadge = "live" | "upcoming" | "cancelled" | null;

/** What history shows for a ride and which actions it offers. */
export interface RideStatus {
  phase: RidePhase;
  badge: RideBadge;
  canTrack: boolean;
  canCancel: boolean;
}

/** When the rider is (or was) picked up: the slot, or payment + the driver's approach. */
export function effectivePickupMs(ride: Ride): number {
  if (ride.scheduled_at !== null) return Date.parse(ride.scheduled_at);
  if (ride.paid_at !== null && ride.pickup_minutes !== null) {
    return Date.parse(ride.paid_at) + ride.pickup_minutes * 60_000;
  }
  return Date.parse(ride.paid_at ?? ride.created_at); // booked before v1.1
}

/**
 * A ride's phase, badge and actions at `nowMs` (H1–H5): Track while it is
 * live, Cancel while it is upcoming; a ride without a timeline (booked before
 * v1.1, T7) is plain history.
 */
export function rideStatus(ride: Ride, nowMs: number, speedup = 1): RideStatus {
  const timeline = timelineFor(ride);
  // Rides booked before v1.1 have no stored pickup time: they are history.
  if (!timeline) {
    return {
      phase: "completed",
      badge: null,
      canTrack: false,
      canCancel: false,
    };
  }
  const { phase } = phaseAt(timeline, nowMs, speedup);
  switch (phase) {
    case "scheduled":
      return { phase, badge: "upcoming", canTrack: false, canCancel: true };
    case "en_route":
    case "arrived":
    case "on_trip":
      return { phase, badge: "live", canTrack: true, canCancel: false };
    case "cancelled":
      return { phase, badge: "cancelled", canTrack: false, canCancel: false };
    default:
      return { phase, badge: null, canTrack: false, canCancel: false };
  }
}

const RANK: Record<string, number> = { live: 0, upcoming: 1 };

/** A new array: Live, then Upcoming soonest-first, then the rest newest-first. */
export function sortRidesForHistory(
  rides: Ride[],
  nowMs: number,
  speedup = 1,
): Ride[] {
  return rides
    .map((ride) => ({
      ride,
      rank: RANK[rideStatus(ride, nowMs, speedup).badge ?? ""] ?? 2,
      at: effectivePickupMs(ride),
    }))
    .sort((a, b) =>
      a.rank !== b.rank
        ? a.rank - b.rank
        : a.rank === 1
          ? a.at - b.at
          : b.at - a.at,
    )
    .map(({ ride }) => ride);
}

/** "3 Oct 2026, 23:30" — the pickup time, on the Zagreb clock (zone as in K12). */
export function formatRideTime(ride: Ride): string {
  return formatZagrebDateTime(effectivePickupMs(ride));
}

/**
 * Where a ride's tracker lives. Every way into it — a history card, the Home
 * banner, a tapped reminder, Go Track — pushes this one href (WP3 entry points).
 */
export function trackRideHref(rideId: number) {
  return {
    pathname: "/(root)/track-ride",
    params: { rideId: String(rideId) },
  } as const;
}
