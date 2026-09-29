/**
 * Shared set-up for API route tests: a real Postgres (PGlite) with the real
 * schema, real Clerk-style JWTs, real quote tokens — only Stripe is faked.
 *
 * Use with, at the top of a test file:
 *   jest.mock("@/server/db", () => ({ sql: () => mockDb.current!.sql }));
 *   jest.mock("@/server/stripe", () => ({ stripe: () => mockStripe }));
 */
import { signQuote, QuotePayload } from "@/server/quote-token";

import { jsonRequest, signTestJwt, applyTestAuthEnv } from "./auth";
import { createTestDb, TestDb } from "./testDb";

export const QUOTE_SECRET = "test-quote-secret-at-least-32-chars!!";

export const mockDb: { current: TestDb | null } = { current: null };

export const mockStripe = {
  paymentIntents: {
    create: jest.fn(),
    confirm: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn(),
  },
  refunds: { create: jest.fn(), list: jest.fn() },
};

const secret = (id: string) => `${id}_secret_x`;

/** `latest_charge` as `expand: ["latest_charge"]` returns it (whole seconds). */
const latestCharge = (chargedAtMs?: number) =>
  chargedAtMs ? { created: Math.floor(chargedAtMs / 1000) } : null;

/**
 * Stripe for one booking: `create` returns an unconfirmed pi_<ride_id>, and
 * `confirm` either resolves with `outcome` (a status) or rejects with it.
 */
export function stripeBooks(
  outcome: string | Error,
  { chargedAtMs }: { chargedAtMs?: number } = {},
) {
  mockStripe.paymentIntents.create.mockImplementation(async (params: any) => ({
    id: `pi_${params.metadata.ride_id}`,
    status: "requires_payment_method",
    client_secret: secret(`pi_${params.metadata.ride_id}`),
    metadata: params.metadata,
  }));
  mockStripe.paymentIntents.confirm.mockImplementation(async (id: string) => {
    if (outcome instanceof Error) throw outcome;
    return {
      id,
      status: outcome,
      client_secret: secret(id),
      latest_charge: latestCharge(chargedAtMs),
    };
  });
}

/** What `retrieve` says about any PaymentIntent from now on. */
export function stripeReports(
  status: string,
  {
    userId = "user_1",
    chargedAtMs,
  }: { userId?: string; chargedAtMs?: number } = {},
) {
  mockStripe.paymentIntents.retrieve.mockImplementation(async (id: string) => ({
    id,
    status,
    metadata: { ride_id: id.replace("pi_", ""), clerk_user_id: userId },
    latest_charge: latestCharge(chargedAtMs),
  }));
}

/** What `refunds.list` shows for any PaymentIntent from now on: refunds with these statuses, newest first. */
export function stripeShowsRefunds(...statuses: string[]) {
  mockStripe.refunds.list.mockImplementation(async () => ({
    data: statuses.map((status, i) => ({ id: `re_${i + 1}`, status })),
  }));
}

export const stripeError = (type: string, message = "Stripe says no") =>
  Object.assign(new Error(message), { type });

export async function setUpApiTest() {
  await applyTestAuthEnv();
  process.env.QUOTE_SIGNING_SECRET = QUOTE_SECRET;
  delete process.env.ML_ENDPOINT_URL;
  mockDb.current = await createTestDb();
  // Reset implementations too, not just calls: one test's Stripe answers
  // must never leak into the next.
  for (const group of Object.values(mockStripe)) {
    for (const fn of Object.values(group)) (fn as jest.Mock).mockReset();
  }
}

export const PICKUP: [number, number] = [45.8, 15.945];
export const DROPOFF: [number, number] = [45.8085, 15.9775];

export async function quoteToken(overrides: Partial<QuotePayload> = {}) {
  return signQuote(
    {
      v: 1,
      pickup: PICKUP,
      dropoff: DROPOFF,
      scheduledAt: null,
      fareCents: 974,
      tripMinutes: 12,
      source: "ml-model",
      iat: Date.now(),
      ...overrides,
    },
    QUOTE_SECRET,
  );
}

export async function asUser(sub = "user_1") {
  return signTestJwt({ sub });
}

export async function post(
  handler: (req: Request, params: any) => Promise<Response>,
  path: string,
  body: unknown,
  token?: string,
) {
  const res = await handler(jsonRequest(path, body, token), {});
  return { status: res.status, body: await res.json() };
}

export async function get(
  handler: (req: Request, params: any) => Promise<Response>,
  path: string,
  token?: string,
) {
  const res = await handler(jsonRequest(path, undefined, token), {});
  return { status: res.status, body: await res.json() };
}

export const rows = (text: TemplateStringsArray, ...values: unknown[]) =>
  mockDb.current!.sql(text, ...values);
