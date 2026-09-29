/**
 * lib/reminders.ts — when to remind a rider about a scheduled ride.
 *
 * One local notification, 10 minutes before the driver sets off, so there is
 * time to get ready — none when that moment has already passed. The copy uses
 * clock times, not "in 10 min": Android 12+ may deliver a reminder late, and
 * the message must still be true when it arrives.
 */

import { timelineFor } from "@/lib/tracking";
import { formatPickupTime } from "@/lib/zagreb-time";
import { Ride } from "@/types/type";

/** How long before the driver sets off the reminder fires. */
export const REMINDER_LEAD_MINUTES = 10;
const MS_PER_MINUTE = 60_000;

/** One local notification: when (server clock) and what it says. */
export interface Reminder {
  id: string;
  rideId: number;
  atMs: number;
  title: string;
  body: string;
}

/** "ride-{id}": the notification identifier, so a cancel or sign-out can find it again (N4). */
export const reminderId = (rideId: number) => `ride-${rideId}`;

/**
 * The reminder a ride calls for at `nowMs` (N1): 10 min before its driver sets
 * off, with the times on the Zagreb clock. Null for a ride now, a cancelled or
 * legacy ride, or once the reminder time has passed (N2).
 */
export function reminderFor(ride: Ride, nowMs: number): Reminder | null {
  const timeline = timelineFor(ride);
  if (!timeline?.isScheduled || ride.cancelled_at !== null) return null;
  const atMs = timeline.departAtMs - REMINDER_LEAD_MINUTES * MS_PER_MINUTE;
  if (atMs <= nowMs) return null;
  const pickupMs = timeline.departAtMs + timeline.pickupMinutes * MS_PER_MINUTE;
  return {
    id: reminderId(ride.ride_id),
    rideId: ride.ride_id,
    atMs,
    title: "Your ride is almost here",
    body: `${ride.driver.first_name} sets off at ${formatPickupTime(timeline.departAtMs)} for your ${formatPickupTime(pickupMs)} pickup.`,
  };
}

/** Every reminder the rider's history calls for (N7): one per upcoming ride. */
export function desiredReminders(rides: Ride[], nowMs: number): Reminder[] {
  return rides.flatMap((ride) => reminderFor(ride, nowMs) ?? []);
}
