import { requireUserId } from "@/server/auth";
import { sql } from "@/server/db";
import { route } from "@/server/http";
import { findRides, reconcile, toPublicRide } from "@/server/rides";
import { stripe } from "@/server/stripe";

/**
 * GET /(api)/rides — the caller's settled rides, newest first.
 *
 * Settles unfinished payments with Stripe first (best effort, bounded), so a
 * ride paid for just before the app died still shows up. `server_time` lets
 * the app correct its clock for the live tracker.
 */
export const GET = route(async (request) => {
  const userId = await requireUserId(request);
  const db = sql();
  await reconcile(db, stripe(), userId);
  const rides = (await findRides(db, userId)).map(toPublicRide);
  return { data: rides, server_time: new Date().toISOString() };
});
