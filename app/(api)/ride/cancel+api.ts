import { rideStatus } from "@/lib/rides";
import { requireUserId } from "@/server/auth";
import { sql } from "@/server/db";
import { HttpError, readJson, route, within } from "@/server/http";
import {
  dropCancelRequest,
  findRide,
  isLiveRefund,
  markCancelled,
  refundedAtStripe,
  requestCancel,
  toPublicRide,
} from "@/server/rides";
import { stripe } from "@/server/stripe";
import { requireInt } from "@/server/validate";

import type Stripe from "stripe";

// X5: Stripe refused the refund, so none was made: the ride stays booked and
// the rider can simply try again.
const refundFailed = () =>
  new HttpError(
    502,
    "The refund didn't go through, so your ride is still booked. Please try again.",
  );

// X21: the refund may have been made. The ride stays as it is until the next
// history read settles it with Stripe (X23); the app checks the ride (X9).
const refundUnknown = () =>
  new HttpError(
    504,
    "We couldn't confirm the refund. Check your ride again in a moment.",
    { code: "refund_unknown" },
  );

/**
 * Refund errors after which Stripe certainly made no refund: it refused the
 * request (a 4xx). Anything else (a Stripe 5xx, a lost connection, no answer)
 * leaves the outcome unknown.
 */
const REFUND_REFUSED = new Set([
  "StripeInvalidRequestError",
  "StripeCardError",
  "StripeRateLimitError",
  "StripePermissionError",
  "StripeAuthenticationError",
]);
/** How long the cancel waits for Stripe to say whether an unknown refund was made (X20). */
const REFUND_CHECK_TIMEOUT_MS = 2000;

/**
 * POST /(api)/ride/cancel — cancel a scheduled ride and refund it in full,
 * allowed until the driver sets off (ADR-012). Idempotent.
 *
 * Each attempt gets its own refund idempotency key: Stripe replays a key's
 * first result for 24 h, so a fixed key would repeat a failed refund (X5).
 * A retry after a refund that did go through is refused by Stripe as
 * `charge_already_refunded`, which finishes the cancel (X7, X8). The cancel is
 * recorded before the refund is asked for, so an answer that is lost on the
 * way is settled by the next history read (X23).
 */
export const POST = route(async (request) => {
  const userId = await requireUserId(request);
  const rideId = requireInt((await readJson(request)).ride_id, "ride_id");
  const db = sql();

  const ride = await findRide(db, userId, rideId);
  if (!ride) throw new HttpError(404, "Ride not found");

  if (ride.cancelled_at === null) {
    if (ride.scheduled_at === null) {
      throw new HttpError(409, "Rides booked for now can't be cancelled", {
        code: "not_cancellable",
      });
    }
    if (ride.payment_status !== "paid") {
      // X22: pending or failed — no money to return, and no driver involved.
      throw new HttpError(
        409,
        "This ride's payment hasn't completed, so there is nothing to cancel.",
        { code: "not_booked" },
      );
    }
    if (!rideStatus(toPublicRide(ride), Date.now()).canCancel) {
      throw new HttpError(
        409,
        "Your driver is already on the way — this ride can no longer be cancelled",
        { code: "not_cancellable" },
      );
    }
    const intentId = ride.payment_intent_id!;
    const client = stripe();
    await requestCancel(db, rideId);
    let refund: Stripe.Refund | null = null;
    try {
      refund = await client.refunds.create(
        { payment_intent: intentId },
        { idempotencyKey: `refund-${intentId}-${crypto.randomUUID()}` },
      );
    } catch (error) {
      const { code, type } = error as { code?: string; type?: string };
      // Refunded already (by an earlier attempt, or in the dashboard): finish.
      if (code !== "charge_already_refunded") {
        if (REFUND_REFUSED.has(type ?? "")) {
          console.error(`ride ${rideId}: refund failed:`, error);
          await dropCancelRequest(db, rideId);
          throw refundFailed();
        }
        // X20: the refund may have gone through; ask Stripe once.
        console.error(`ride ${rideId}: refund outcome unknown:`, error);
        const refunded = await within(
          REFUND_CHECK_TIMEOUT_MS,
          refundedAtStripe(client, intentId),
        ).catch(() => false);
        if (!refunded) throw refundUnknown(); // X21
      }
    }
    if (refund !== null && !isLiveRefund(refund)) {
      console.error(`ride ${rideId}: refund ${refund.id} is ${refund.status}`);
      await dropCancelRequest(db, rideId);
      throw refundFailed();
    }
    await markCancelled(db, rideId);
  }

  return { data: toPublicRide((await findRide(db, userId, rideId))!) };
});
