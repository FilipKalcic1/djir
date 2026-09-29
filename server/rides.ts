/**
 * server/rides.ts — every SQL statement about rides, in one place.
 *
 * Booking is "reserve first" (ADR-013): the ride row is written as `pending`,
 * the PaymentIntent is created unconfirmed and its id saved on the row, and
 * only then is the card charged. So no money can move for a ride we cannot
 * find again. Reads settle pending rides against Stripe (`reconcile`), so every
 * succeeded payment maps to exactly one visible ride — even if the app died
 * right after paying. Cancels are recorded before the refund is asked for, and
 * the same reads settle a cancel whose answer was lost (X23), so a refunded
 * ride never stays booked.
 */

import { Ride } from "@/types/type";

import type { Sql } from "@/server/db";
import type Stripe from "stripe";

const MINUTE_MS = 60_000;
/**
 * A reservation that never got a PaymentIntent after this long never will;
 * one whose PaymentIntent Stripe does not know (after a key or account
 * switch) is given up after the same time.
 */
const ORPHAN_AFTER_MS = 10 * MINUTE_MS;
/** An unfinished payment (3-D Secure not completed) after this long was abandoned. */
const ABANDONED_AFTER_MS = 30 * MINUTE_MS;
/**
 * Reconcile is best-effort: bounded work, bounded wait, never blocks history.
 * Rows never checked come first, newest first (the booking the rider is
 * waiting on), then the least recently checked, so a row that errors on every
 * read cannot hold its place ahead of newer ones (M10).
 */
const RECONCILE_MAX_ROWS = 3;
const RECONCILE_BUDGET_MS = 2000;
/**
 * A cancel whose refund Stripe still does not show after this long made none:
 * the cancel route has answered long before (E6's 31.5 s plus the 2 s check),
 * so the request is dropped and the ride stays booked (X23).
 */
const CANCEL_REQUEST_EXPIRES_MS = 2 * MINUTE_MS;

type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type StoredRide = Omit<Ride, "payment_status"> & {
  payment_intent_id: string | null;
  payment_status: PaymentStatus;
};

const iso = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString();

function toRide(row: Record<string, any>): StoredRide {
  return {
    ...(row as StoredRide),
    created_at: iso(row.created_at)!,
    paid_at: iso(row.paid_at),
    scheduled_at: iso(row.scheduled_at),
    cancelled_at: iso(row.cancelled_at),
  };
}

// One SELECT shape for every read. NUMERIC columns are cast so the wire types
// are numbers; the driver comes back as one JSON object. History keeps only
// settled rides IN SQL, before the LIMIT, so failed attempts can never push a
// paid ride out of it (M11); a lookup by id sees every status.
async function selectRides(
  db: Sql,
  userId: string,
  rideId: number | null,
  settledOnly: boolean,
): Promise<StoredRide[]> {
  const rows = await db`
    SELECT
      rides.ride_id,
      rides.origin_address,
      rides.destination_address,
      rides.origin_latitude::float8       AS origin_latitude,
      rides.origin_longitude::float8      AS origin_longitude,
      rides.destination_latitude::float8  AS destination_latitude,
      rides.destination_longitude::float8 AS destination_longitude,
      rides.ride_time,
      rides.pickup_minutes::int           AS pickup_minutes,
      rides.fare_price::float8            AS fare_price,
      rides.payment_status,
      rides.payment_intent_id,
      rides.created_at,
      rides.paid_at,
      rides.scheduled_at,
      rides.cancelled_at,
      json_build_object(
        'driver_id', drivers.id,
        'first_name', drivers.first_name,
        'last_name', drivers.last_name,
        'profile_image_url', drivers.profile_image_url,
        'car_image_url', drivers.car_image_url,
        'car_seats', drivers.car_seats,
        'rating', drivers.rating::float8
      ) AS driver
    FROM rides
    INNER JOIN drivers ON rides.driver_id = drivers.id
    WHERE rides.user_id = ${userId}
      AND (${rideId}::int IS NULL OR rides.ride_id = ${rideId}::int)
      AND (NOT ${settledOnly}::boolean
           OR rides.payment_status IN ('paid', 'refunded'))
    ORDER BY rides.created_at DESC
    LIMIT 100`;
  return rows.map(toRide);
}

/** The rider's history: settled rides only (paid, or refunded after a cancel), newest first. */
export function findRides(db: Sql, userId: string): Promise<StoredRide[]> {
  return selectRides(db, userId, null, true);
}

/** One of the rider's rides, whatever its payment status (confirm, cancel). */
export async function findRide(
  db: Sql,
  userId: string,
  rideId: number,
): Promise<StoredRide | null> {
  return (await selectRides(db, userId, rideId, false))[0] ?? null;
}

/** The ride as the rider sees it: no Stripe ids. */
export function toPublicRide(ride: StoredRide): Ride {
  const { payment_intent_id: _, ...rest } = ride;
  return rest as Ride;
}

/**
 * What to do with a ride, given its PaymentIntent's status and age.
 *
 *   succeeded                                → paid (also from failed)
 *   canceled                                 → failed
 *   requires_payment_method / _confirmation  → pending, then cancel + failed after 30 min
 *   requires_action / other                  → pending, then cancel + failed after 30 min
 *   processing                               → pending (Stripe refuses to cancel it; PT3b)
 */
export function nextPaymentState(
  intentStatus: Stripe.PaymentIntent.Status,
  ageMs: number,
): "paid" | "failed" | "pending" | "cancel" {
  if (intentStatus === "succeeded") return "paid";
  if (intentStatus === "canceled") return "failed";
  if (intentStatus === "processing") return "pending";
  return ageMs > ABANDONED_AFTER_MS ? "cancel" : "pending";
}

/** When the charge happened (for a ride now: when the driver sets off). */
export function chargedAtMs(intent: Stripe.PaymentIntent, fallbackMs: number) {
  const charge = intent.latest_charge;
  return typeof charge === "object" && charge?.created
    ? charge.created * 1000
    : fallbackMs;
}

/** Apply one PaymentIntent's state to its pending ride (the transition table). */
export async function settleRide(
  db: Sql,
  stripe: Stripe,
  ride: {
    ride_id: number;
    payment_intent_id: string | null;
    created_at: Date | string;
  },
  nowMs: number,
): Promise<"paid" | "failed" | "pending"> {
  const ageMs = nowMs - new Date(ride.created_at).getTime();
  if (!ride.payment_intent_id) {
    if (ageMs <= ORPHAN_AFTER_MS) return "pending";
    await markFailed(db, ride.ride_id); // PT4: never reached Stripe
    return "failed";
  }
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(ride.payment_intent_id, {
      expand: ["latest_charge"],
    });
  } catch (error) {
    // PT4b: this Stripe account has no such PaymentIntent, so it charged nothing.
    if (!isResourceMissing(error) || ageMs <= ORPHAN_AFTER_MS) throw error;
    await markFailed(db, ride.ride_id);
    return "failed";
  }
  const next = nextPaymentState(intent.status, ageMs);
  if (next === "paid") {
    await markPaid(db, ride.ride_id, chargedAtMs(intent, nowMs)); // PT1
    return "paid";
  }
  if (next === "cancel") {
    try {
      await stripe.paymentIntents.cancel(ride.payment_intent_id); // PT3
    } catch (error) {
      // E.g. the rider finished 3-D Secure meanwhile. It stays pending, and a
      // later check (taking its turn, M10) reads what Stripe did instead.
      console.error(
        `ride ${ride.ride_id}: could not cancel abandoned PaymentIntent ${ride.payment_intent_id}:`,
        error,
      );
      return "pending";
    }
  }
  if (next !== "pending") {
    await markFailed(db, ride.ride_id); // PT2 / PT3
    return "failed";
  }
  return "pending";
}

const isResourceMissing = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "resource_missing";

/** A refund that returned, or will return, the money: anything but failed or canceled. */
export const isLiveRefund = (refund: Pick<Stripe.Refund, "status">) =>
  refund.status !== "failed" && refund.status !== "canceled";

/**
 * Has Stripe refunded this payment? Djir only makes full refunds, so the
 * newest refund decides (X20, X23).
 */
export async function refundedAtStripe(
  stripe: Stripe,
  intentId: string,
): Promise<boolean> {
  const { data } = await stripe.refunds.list({
    payment_intent: intentId,
    limit: 1,
  });
  return data.length > 0 && isLiveRefund(data[0]);
}

/**
 * Settle a paid ride whose cancel was asked for but never confirmed (X23): a
 * refund Stripe shows cancels the ride; with none after
 * `CANCEL_REQUEST_EXPIRES_MS` the request is dropped and the ride stays booked.
 */
export async function settleCancel(
  db: Sql,
  stripe: Stripe,
  ride: {
    ride_id: number;
    payment_intent_id: string;
    cancel_requested_at: Date | string;
  },
  nowMs: number,
): Promise<"refunded" | "paid" | "unknown"> {
  if (await refundedAtStripe(stripe, ride.payment_intent_id)) {
    await markCancelled(db, ride.ride_id);
    return "refunded";
  }
  const ageMs = nowMs - new Date(ride.cancel_requested_at).getTime();
  if (ageMs <= CANCEL_REQUEST_EXPIRES_MS) return "unknown";
  await dropCancelRequest(db, ride.ride_id);
  return "paid";
}

/**
 * Settle this user's open rides against Stripe (see the module comment): the
 * pending ones, and paid ones with a cancel whose outcome is unknown (X23).
 * At most 3 per read: never checked first, newest question first (the booking
 * or cancel the rider is waiting on), then least recently checked, then
 * oldest. Every attempt is stamped (`reconciled_at`) before it starts, so a
 * row that errors or hangs still gives up its turn. The rows are settled in
 * parallel within one time budget; errors are logged and retried later, so
 * history never waits on Stripe for long.
 */
export async function reconcile(
  db: Sql,
  stripe: Stripe,
  userId: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const open = await db`
    SELECT ride_id, payment_intent_id, payment_status, created_at, cancel_requested_at
    FROM rides
    WHERE user_id = ${userId}
      AND (payment_status = 'pending'
           OR (payment_status = 'paid' AND cancel_requested_at IS NOT NULL))
    ORDER BY reconciled_at ASC NULLS FIRST,
             CASE WHEN reconciled_at IS NULL
                  THEN COALESCE(cancel_requested_at, created_at) END DESC,
             created_at ASC
    LIMIT ${RECONCILE_MAX_ROWS}`;
  if (open.length === 0) return;
  await db`UPDATE rides SET reconciled_at = now()
           WHERE ride_id = ANY(${open.map((ride) => ride.ride_id)}::int[])`;

  const work = Promise.allSettled(
    open.map((ride) =>
      (ride.payment_status === "paid"
        ? settleCancel(db, stripe, ride as never, nowMs)
        : settleRide(db, stripe, ride as never, nowMs)
      ).catch((error) => {
        console.warn(`reconcile ride ${ride.ride_id}:`, error);
        throw error;
      }),
    ),
  );
  // Armed after the work has started, so a test's fake clock can own it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, RECONCILE_BUDGET_MS);
  });
  await Promise.race([work, budget]);
  clearTimeout(timer);
}

export interface Reservation {
  userId: string;
  driverId: number;
  originAddress: string;
  destinationAddress: string;
  pickup: [number, number];
  dropoff: [number, number];
  tripMinutes: number;
  pickupMinutes: number;
  fareCents: number;
  scheduledAt: number | null;
}

/** Write the ride as `pending` before any money moves. */
export async function reserveRide(db: Sql, r: Reservation): Promise<number> {
  const [row] = await db`
    INSERT INTO rides (
      origin_address, destination_address,
      origin_latitude, origin_longitude, destination_latitude, destination_longitude,
      ride_time, pickup_minutes, fare_price, payment_status,
      driver_id, user_id, scheduled_at
    ) VALUES (
      ${r.originAddress}, ${r.destinationAddress},
      ${r.pickup[0]}, ${r.pickup[1]}, ${r.dropoff[0]}, ${r.dropoff[1]},
      ${r.tripMinutes}, ${r.pickupMinutes}, ${r.fareCents / 100}, 'pending',
      ${r.driverId}, ${r.userId},
      ${r.scheduledAt === null ? null : new Date(r.scheduledAt).toISOString()}
    )
    RETURNING ride_id`;
  return row.ride_id;
}

export async function attachIntent(db: Sql, rideId: number, intentId: string) {
  await db`UPDATE rides SET payment_intent_id = ${intentId} WHERE ride_id = ${rideId}`;
}

export async function markFailed(db: Sql, rideId: number) {
  await db`UPDATE rides SET payment_status = 'failed'
           WHERE ride_id = ${rideId} AND payment_status = 'pending'`;
}

/** pending|failed → paid, once. `paidAtMs` is when the driver sets off (rides now). */
export async function markPaid(db: Sql, rideId: number, paidAtMs: number) {
  await db`UPDATE rides
           SET payment_status = 'paid', paid_at = ${new Date(paidAtMs).toISOString()}
           WHERE ride_id = ${rideId} AND payment_status IN ('pending', 'failed')`;
}

export async function markCancelled(db: Sql, rideId: number) {
  await db`UPDATE rides
           SET cancelled_at = now(), payment_status = 'refunded', cancel_requested_at = NULL
           WHERE ride_id = ${rideId} AND cancelled_at IS NULL`;
}

/**
 * Record a cancel before its refund is asked for, so a lost answer (X21), a
 * failed write (X8) or a crash is settled by the next history read (X23). The
 * row counts as never checked again, so that read takes it first.
 */
export async function requestCancel(db: Sql, rideId: number) {
  await db`UPDATE rides SET cancel_requested_at = now(), reconciled_at = NULL
           WHERE ride_id = ${rideId} AND payment_status = 'paid'`;
}

/** Stripe made no refund: the ride stays booked, and reads stop asking (X5, X23). */
export async function dropCancelRequest(db: Sql, rideId: number) {
  await db`UPDATE rides SET cancel_requested_at = NULL
           WHERE ride_id = ${rideId} AND payment_status = 'paid'`;
}
