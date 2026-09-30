/**
 * GET /(api)/health is public and names the server settings that are still
 * missing — never a value, and never a value's length (EG2). The env is set
 * per test; nothing else is faked.
 */
import { GET as health } from "@/app/(api)/health+api";

import { jsonRequest } from "../helpers/auth";

const NAMES = [
  "DATABASE_URL",
  "CLERK_JWT_KEY",
  "QUOTE_SIGNING_SECRET",
  "STRIPE_SECRET_KEY",
] as const;

/** Values no answer may contain, whole or in part. */
const VALUES = {
  DATABASE_URL: "postgres://djir_owner:hunter2-db@ep-cool.neon.tech/djir",
  CLERK_JWT_KEY:
    "-----BEGIN PUBLIC KEY-----\\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\\n-----END PUBLIC KEY-----",
  QUOTE_SIGNING_SECRET: "q7-secret-signing-value-0123456789abcdef",
  STRIPE_SECRET_KEY: "sk_test_51NsecretStripeValue",
};

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = process.env;
  process.env = { ...saved };
  for (const name of NAMES) delete process.env[name];
});
afterEach(() => {
  process.env = saved;
});

async function ask() {
  const res = await health(jsonRequest("/health"), {});
  const text = await res.text();
  return {
    status: res.status,
    cache: res.headers.get("Cache-Control"),
    text,
    body: JSON.parse(text),
  };
}

describe("GET /(api)/health", () => {
  it("EG2: is public — answers without a session, and is never cached", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.cache).toBe("no-store");
  });

  it("EG2: with no settings, names all four as missing", async () => {
    expect((await ask()).body).toEqual({
      ok: false,
      missing: [
        "DATABASE_URL",
        "CLERK_JWT_KEY",
        "QUOTE_SIGNING_SECRET",
        "STRIPE_SECRET_KEY",
      ],
    });
  });

  it("EG2: with every setting in place, it is ok and its answer holds no value", async () => {
    Object.assign(process.env, VALUES);

    const res = await ask();

    expect(res.body).toEqual({ ok: true, missing: [] });
    expect(res.text).toBe('{"ok":true,"missing":[]}');
  });

  it.each(NAMES)(
    "EG2: names %s alone when only it is missing, and leaks none of the others' values",
    async (name) => {
      Object.assign(process.env, VALUES);
      delete process.env[name];

      const res = await ask();

      expect(res.body).toEqual({ ok: false, missing: [name] });
      for (const value of Object.values(VALUES)) {
        expect(res.text).not.toContain(value.slice(0, 12));
      }
    },
  );

  it("EG2: a QUOTE_SIGNING_SECRET under 32 characters reads exactly like a missing one — no length is given away", async () => {
    Object.assign(process.env, VALUES, { QUOTE_SIGNING_SECRET: "too-short" });
    const short = await ask();
    delete process.env.QUOTE_SIGNING_SECRET;
    const unset = await ask();

    expect(short.text).toBe('{"ok":false,"missing":["QUOTE_SIGNING_SECRET"]}');
    expect(short.text).toBe(unset.text);
    expect(short.text).not.toMatch(/\d/);
  });
});
