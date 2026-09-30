import { healthReport } from "@/lib/setup";
import { route } from "@/server/http";

/**
 * GET /(api)/health — public: which server settings are still missing, by
 * name only (EG2). It never answers with a value or a value's length: a
 * QUOTE_SIGNING_SECRET that is too short is simply listed as missing. The
 * app's "Setup needed" screen reads it, so the owner can tell a missing
 * setting from an API the phone cannot reach.
 *
 * Each setting is read as `process.env.NAME` itself (see server/http.ts
 * `requireEnv`), and the answer is never cached: it must follow the env file.
 */
export const GET = route(async () =>
  Response.json(
    healthReport({
      DATABASE_URL: process.env.DATABASE_URL,
      CLERK_JWT_KEY: process.env.CLERK_JWT_KEY,
      QUOTE_SIGNING_SECRET: process.env.QUOTE_SIGNING_SECRET,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    }),
    { headers: { "Cache-Control": "no-store" } },
  ),
);
