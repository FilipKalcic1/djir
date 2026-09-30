/**
 * lib/setup — which keys the app and which settings the API still need
 * (EG1–EG3). Pure: it is handed the values, and only ever answers with names
 * and a status.
 */
import {
  APP_KEYS,
  canStart,
  checkAppKeys,
  healthReport,
  isClerkPublishableKey,
  isStripePublishableKey,
  keyStatus,
  missingServerSettings,
  QUOTE_SECRET_MIN_LENGTH,
  readHealthReport,
  SERVER_SETTINGS,
} from "@/lib/setup";

/** A publishable key for the Frontend API `host`, built the way Clerk builds one. */
const clerkKey = (host: string, prefix = "pk_test_") =>
  `${prefix}${btoa(`${host}$`)}`;
const CLERK_KEY = clerkKey("clever-cat-12.clerk.accounts.dev");
const STRIPE_KEY = "pk_test_51Nabc";
const SECRET = "s".repeat(QUOTE_SECRET_MIN_LENGTH);

const ALL_SERVER_SETTINGS = {
  DATABASE_URL: "postgres://user:pw@db.neon.tech/djir",
  CLERK_JWT_KEY:
    "-----BEGIN PUBLIC KEY-----\\nMIIB…\\n-----END PUBLIC KEY-----",
  QUOTE_SIGNING_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_test_51Nabc",
};

describe("isClerkPublishableKey (what ClerkProvider throws on)", () => {
  it.each([
    ["a development key", CLERK_KEY],
    ["a production key", clerkKey("clerk.djir.app", "pk_live_")],
    ["a key without base64 padding", "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k"],
  ])("EG1: accepts %s", (_, key) => {
    expect(isClerkPublishableKey(key)).toBe(true);
  });

  it.each([
    ["the dashboard's secret key", "sk_test_abc"],
    ["an unknown instance type", clerkKey("clerk.djir.app", "pk_prod_")],
    ["a prefix only", "pk_test_"],
    ["an extra underscore", `${CLERK_KEY}_x`],
    ["a body that is not base64", "pk_test_%%%"],
    ["a host without the trailing $", `pk_test_${btoa("clerk.djir.app")}`],
    ["a host with a second $", clerkKey("clerk$.djir.app")],
    ["a host without a dot", clerkKey("localhost")],
    ["a placeholder", "pk_test_xxx"],
    [
      "a key with a leading space (checked as bundled, untrimmed)",
      ` ${CLERK_KEY}`,
    ],
  ])("EG1: refuses %s", (_, key) => {
    expect(isClerkPublishableKey(key)).toBe(false);
  });
});

describe("isStripePublishableKey", () => {
  it("EG1: accepts test and live publishable keys", () => {
    expect(isStripePublishableKey("pk_test_51Nabc")).toBe(true);
    expect(isStripePublishableKey("pk_live_51Nabc")).toBe(true);
  });

  it("EG1: refuses a secret or restricted key, which must never ship in the app", () => {
    expect(isStripePublishableKey("sk_test_51Nabc")).toBe(false);
    expect(isStripePublishableKey("rk_live_51Nabc")).toBe(false);
    expect(isStripePublishableKey("pk_test_")).toBe(false);
    expect(isStripePublishableKey("pk_test_51N abc")).toBe(false);
  });
});

describe("keyStatus", () => {
  it("EG1: an unset or empty key is missing", () => {
    expect(keyStatus("EXPO_PUBLIC_PLACES_API_KEY", undefined)).toBe("missing");
    expect(keyStatus("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "")).toBe("missing");
  });

  it("EG1: a Clerk or Stripe key of the wrong kind is invalid; others are set by being there", () => {
    expect(keyStatus("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_xxx")).toBe(
      "invalid",
    );
    expect(
      keyStatus("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", "sk_test_51Nabc"),
    ).toBe("invalid");
    expect(keyStatus("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", CLERK_KEY)).toBe(
      "set",
    );
    expect(keyStatus("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", STRIPE_KEY)).toBe(
      "set",
    );
    expect(keyStatus("EXPO_PUBLIC_PLACES_API_KEY", "AIza-anything")).toBe(
      "set",
    );
  });
});

describe("checkAppKeys and canStart", () => {
  it("EG1: lists every app key in order — Clerk required, the rest optional — with what each unlocks", () => {
    expect(
      checkAppKeys({}).map(({ name, required, status }) => [
        name,
        required,
        status,
      ]),
    ).toEqual([
      ["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", true, "missing"],
      ["EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", false, "missing"],
      ["EXPO_PUBLIC_PLACES_API_KEY", false, "missing"],
      ["EXPO_PUBLIC_DIRECTIONS_API_KEY", false, "missing"],
      ["EXPO_PUBLIC_GEOAPIFY_API_KEY", false, "missing"],
    ]);
    expect(checkAppKeys({}).map((check) => check.unlocks)).toEqual(
      APP_KEYS.map((key) => key.unlocks),
    );
    expect(APP_KEYS[1].unlocks).toBe(
      "Paying for a ride (Confirm Ride / Schedule Ride).",
    );
    expect(APP_KEYS[2].unlocks).toBe("Searching the From and To addresses.");
  });

  it("EG1: the app cannot start without a valid Clerk publishable key", () => {
    expect(canStart(checkAppKeys({}))).toBe(false);
    expect(
      canStart(
        checkAppKeys({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_xxx" }),
      ),
    ).toBe(false);
  });

  it("EG1: a valid Clerk key is enough to start; the optional keys only unlock features", () => {
    const checks = checkAppKeys({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: CLERK_KEY,
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "sk_test_oops",
    });

    expect(canStart(checks)).toBe(true);
    expect(checks.map((check) => check.status)).toEqual([
      "set",
      "invalid",
      "missing",
      "missing",
      "missing",
    ]);
  });
});

describe("missingServerSettings and healthReport", () => {
  it("EG2: with nothing configured, names all four settings in order", () => {
    expect(missingServerSettings({})).toEqual([
      "DATABASE_URL",
      "CLERK_JWT_KEY",
      "QUOTE_SIGNING_SECRET",
      "STRIPE_SECRET_KEY",
    ]);
    expect(SERVER_SETTINGS.map((setting) => setting.name)).toEqual(
      missingServerSettings({}),
    );
  });

  it("EG2: everything configured is healthy", () => {
    expect(healthReport(ALL_SERVER_SETTINGS)).toEqual({
      ok: true,
      missing: [],
    });
  });

  it.each(Object.keys(ALL_SERVER_SETTINGS))(
    "EG2: an empty %s is missing, and only it",
    (name) => {
      expect(healthReport({ ...ALL_SERVER_SETTINGS, [name]: "" })).toEqual({
        ok: false,
        missing: [name],
      });
    },
  );

  it("EG2: a QUOTE_SIGNING_SECRET shorter than 32 characters is reported exactly like a missing one", () => {
    const short = {
      ...ALL_SERVER_SETTINGS,
      QUOTE_SIGNING_SECRET: "s".repeat(31),
    };
    const unset = { ...ALL_SERVER_SETTINGS, QUOTE_SIGNING_SECRET: undefined };

    expect(healthReport(short)).toEqual({
      ok: false,
      missing: ["QUOTE_SIGNING_SECRET"],
    });
    expect(healthReport(short)).toEqual(healthReport(unset));
  });
});

describe("readHealthReport", () => {
  it("EG3: reads the missing settings from a health report", () => {
    expect(readHealthReport({ ok: true, missing: [] })).toEqual([]);
    expect(
      readHealthReport({
        ok: false,
        missing: ["CLERK_JWT_KEY", "STRIPE_SECRET_KEY"],
      }),
    ).toEqual(["CLERK_JWT_KEY", "STRIPE_SECRET_KEY"]);
  });

  it("EG3: drops names it does not know, so the screen only ever shows its own settings", () => {
    expect(
      readHealthReport({
        ok: false,
        missing: ["DATABASE_URL", "<script>", 42, null],
      }),
    ).toEqual(["DATABASE_URL"]);
  });

  it.each([
    ["null", null],
    ["an HTML page", "<!DOCTYPE html><html></html>"],
    ["another route's answer", { data: [] }],
    ["a report without ok", { missing: [] }],
    [
      "a report whose missing is not a list",
      { ok: false, missing: "DATABASE_URL" },
    ],
  ])("EG3: %s is not a health report", (_, body) => {
    expect(readHealthReport(body)).toBeNull();
  });
});
