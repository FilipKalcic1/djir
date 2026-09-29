import { driverStartFor } from "@/lib/map";
import { pickupMinutesFor } from "@/lib/pricing";
import { requireUserId } from "@/server/auth";
import { sql } from "@/server/db";
import { HttpError, readJson, requireEnv, route, within } from "@/server/http";
import { verifyQuote } from "@/server/quote-token";
import {
  attachIntent,
  chargedAtMs,
  markFailed,
  markPaid,
  reserveRide,
} from "@/server/rides";
import { stripe } from "@/server/stripe";
import {
  requireBookableSlot,
  requireInt,
  requireString,
} from "@/server/validate";

import type { Sql } from "@/server/db";
import type Stripe from "stripe";

export const STRIPE_RETURN_URL = "djir://stripe-redirect";

// Errors after which nothing was (or will be) charged for this attempt.
const DEFINITELY_FAILED = new Set([
  "StripeCardError",
  "StripeInvalidRequestError",
]);
/** E3's check with Stripe (the retrieve, and a cancel if needed) gets 2 s in total. */
const SETTLE_TIMEOUT_MS = 2000;
/** A confirm that never took effect leaves the PaymentIntent in one of these. */
const NEVER_CONFIRMED = new Set<string>([
  "requires_payment_method",
  "requires_confirmation",
]);

// `ride_id` names the ride the app can settle later with /ride/confirm (P8).
const paymentUnknown = (rideId: number) =>
  new HttpError(
    502,
    "We couldn't confirm whether your payment went through. Check Rides before booking again.",
    { code: "payment_unknown", ride_id: rideId },
  );

// E3: Stripe says the payment can no longer be taken — the app may offer a retry.
const notCharged = () =>
  new HttpError(
    502,
    "The payment didn't go through, and nothing was charged. Please try again.",
    { code: "not_charged" },
  );

/**
 * After an inconclusive confirm: what did Stripe actually do? (E3) A confirm
 * that never took effect is cancelled at Stripe, so that "nothing was charged"
 * is certain; if Stripe refuses (the payment moved on) or does not answer in
 * time, the outcome stays unknown.
 */
async function outcomeOf(
  intentId: string,
): Promise<Stripe.PaymentIntent | "not_charged" | "unknown"> {
  const client = stripe();
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  try {
    const intent = await within(
      SETTLE_TIMEOUT_MS,
      client.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }),
    );
    if (intent.status === "succeeded" || intent.status === "requires_action") {
      return intent;
    }
    if (intent.status === "canceled") return "not_charged";
    if (!NEVER_CONFIRMED.has(intent.status)) return "unknown"; // processing
    await within(deadline - Date.now(), client.paymentIntents.cancel(intentId));
    return "not_charged";
  } catch {
    return "unknown";
  }
}

/** E3: a charge that went through continues as usual; anything else is a 502. */
async function settleUnknownOutcome(db: Sql, rideId: number, intentId: string) {
  const outcome = await outcomeOf(intentId);
  if (outcome === "not_charged") {
    await markFailed(db, rideId);
    throw notCharged();
  }
  // The ride stays pending; GET /rides settles it from Stripe (M4).
  if (outcome === "unknown") throw paymentUnknown(rideId);
  return outcome;
}

/**
 * POST /(api)/ride/book — reserve a ride, then charge the card (ADR-013).
 *
 *   1. INSERT the ride as `pending`   (amount, trip, slot from the signed quote;
 *                                      the rider from the session — never the body)
 *   2. create the PaymentIntent        (unconfirmed: no money moves yet)
 *   3. save its id on the ride
 *   4. confirm it                      (the charge; 3-D Secure may follow in the app)
 *   5. on success, mark it paid        (at the charge time, as confirm and reconcile do)
 *
 * If the process dies anywhere, the ride can be found again from its
 * PaymentIntent (or never charged), and GET /rides settles it.
 */
export const POST = route(async (request) => {
  const userId = await requireUserId(request);
  const body = await readJson(request);
  const quote = await verifyQuote(
    body.quote_token,
    requireEnv(process.env.QUOTE_SIGNING_SECRET, "QUOTE_SIGNING_SECRET"),
  );
  const driverId = requireInt(body.driver_id, "driver_id");
  const paymentMethodId = requireString(
    body.payment_method_id,
    "payment_method_id",
  );
  const originAddress = requireString(body.origin_address, "origin_address");
  const destinationAddress = requireString(
    body.destination_address,
    "destination_address",
  );

  if (quote.scheduledAt !== null) {
    requireBookableSlot(quote.scheduledAt, Date.now(), 409); // K2, K6
  }

  const db = sql();
  const [driver] = await db`SELECT id FROM drivers WHERE id = ${driverId}`;
  if (!driver) throw new HttpError(400, "That driver is no longer available");

  const pickup = { latitude: quote.pickup[0], longitude: quote.pickup[1] };
  const rideId = await reserveRide(db, {
    userId,
    driverId,
    originAddress,
    destinationAddress,
    pickup: quote.pickup,
    dropoff: quote.dropoff,
    tripMinutes: quote.tripMinutes,
    pickupMinutes: pickupMinutesFor(driverStartFor(driverId, pickup), pickup),
    fareCents: quote.fareCents,
    scheduledAt: quote.scheduledAt,
  });

  let intent;
  try {
    intent = await stripe().paymentIntents.create(
      {
        amount: quote.fareCents,
        currency: "eur",
        payment_method_types: ["card"],
        capture_method: "automatic",
        metadata: { ride_id: String(rideId), clerk_user_id: userId },
      },
      // A nonce, not just the ride id: ids restart after a database reset,
      // and Stripe remembers idempotency keys for 24 hours.
      { idempotencyKey: `ride-${rideId}-${crypto.randomUUID()}` },
    );
  } catch (error) {
    // E4: whatever Stripe said, nothing was charged, and it is not the card.
    await markFailed(db, rideId);
    console.error(`ride ${rideId}: creating the PaymentIntent failed:`, error);
    throw new HttpError(
      502,
      "We couldn't start the payment, and nothing was charged. Please try again.",
      { code: "not_charged" },
    );
  }
  await attachIntent(db, rideId, intent.id);

  try {
    intent = await stripe().paymentIntents.confirm(intent.id, {
      payment_method: paymentMethodId,
      use_stripe_sdk: true,
      return_url: STRIPE_RETURN_URL,
      expand: ["latest_charge"], // paid_at = the charge time (PT1)
    });
  } catch (error) {
    const type = (error as { type?: string }).type ?? "";
    if (DEFINITELY_FAILED.has(type)) {
      await markFailed(db, rideId); // E1/E2: declined or rejected, nothing charged
      if (type === "StripeCardError") throw error; // E1: 402, Stripe's message
      console.error(`ride ${rideId}: Stripe rejected the payment:`, error);
      throw new HttpError(
        400,
        "The payment could not be processed. Please try another card.",
        { code: "card_rejected" }, // E2: no Stripe internals
      );
    }
    // E3: the outcome is unknown (timeout, connection or API error). Ask
    // Stripe once before answering, so the rider is never invited to pay again
    // for a charge that actually went through.
    intent = await settleUnknownOutcome(db, rideId, intent.id);
  }

  if (intent.status === "succeeded") {
    try {
      await markPaid(db, rideId, chargedAtMs(intent, Date.now()));
    } catch (error) {
      // The card is charged: answer 200 regardless. /ride/confirm and the
      // reconcile on GET /rides settle the row.
      console.error(`ride ${rideId}: paid, but marking it failed:`, error);
    }
  }

  return {
    ride_id: rideId,
    client_secret: intent.client_secret,
    status: intent.status,
  };
});
