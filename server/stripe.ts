/**
 * server/stripe.ts — the Stripe server client, created on first use.
 *
 * Each Stripe call gives up after 10 s (the library default is 80 s) and is
 * retried at most twice, with the library's automatic idempotency key, so a
 * hanging Stripe bounds a route instead of the host's request timeout (E6).
 */

import Stripe from "stripe";

import { requireEnv } from "@/server/http";

export const STRIPE_TIMEOUT_MS = 10_000;
export const STRIPE_MAX_NETWORK_RETRIES = 2;

let client: Stripe | null = null;

export function stripe(): Stripe {
  client ??= new Stripe(
    requireEnv(process.env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"),
    {
      timeout: STRIPE_TIMEOUT_MS,
      maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    },
  );
  return client;
}
