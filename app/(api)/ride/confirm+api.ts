import { requireUserId } from "@/server/auth";
import { sql } from "@/server/db";
import { HttpError, readJson, route } from "@/server/http";
import {
  chargedAtMs,
  findRide,
  markPaid,
  nextPaymentState,
  toPublicRide,
} from "@/server/rides";
import { stripe } from "@/server/stripe";
import { requireInt } from "@/server/validate";

/**
 * POST /(api)/ride/confirm — after the Payment Sheet succeeds, mark the ride
 * paid if (and only if) Stripe says its PaymentIntent succeeded and belongs to
 * the caller. Idempotent: confirming a paid ride returns it again.
 */
export const POST = route(async (request) => {
  const userId = await requireUserId(request);
  const rideId = requireInt((await readJson(request)).ride_id, "ride_id");
  const db = sql();

  const ride = await findRide(db, userId, rideId);
  if (!ride) throw new HttpError(404, "Ride not found");

  const incomplete = () =>
    new HttpError(409, "The payment has not completed", {
      code: "payment_incomplete",
    });

  if (ride.payment_status === "pending" || ride.payment_status === "failed") {
    if (!ride.payment_intent_id) throw incomplete();
    const intent = await stripe().paymentIntents.retrieve(
      ride.payment_intent_id,
      {
        expand: ["latest_charge"],
      },
    );
    if (intent.metadata.clerk_user_id !== userId) {
      throw new HttpError(404, "Ride not found");
    }
    // The same transition table as reconcile: only a succeeded payment pays.
    if (nextPaymentState(intent.status, 0) !== "paid") throw incomplete();
    await markPaid(db, rideId, chargedAtMs(intent, Date.now()));
  }

  return { data: toPublicRide((await findRide(db, userId, rideId))!) };
});
