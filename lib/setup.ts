/**
 * lib/setup.ts — what the app and its API still need before they can run
 * (EG1–EG3): the EXPO_PUBLIC_* keys bundled into the app, and the settings the
 * API routes read on the server. Only names and "set / missing / not valid"
 * ever leave this module: never a value, and never a value's length.
 */

/** Where every key and setting goes: the project's env file, read by `npx expo start`. */
export const ENV_FILE = ".env.local";

interface KeyInfo {
  name: string;
  /** Without it the app cannot start (EG1). */
  required: boolean;
  /** What the key unlocks, in the owner's words. */
  unlocks: string;
  /** Where to get it. */
  source: string;
}

/** The app's EXPO_PUBLIC_* keys: the one the app needs to start, then the optional ones. */
export const APP_KEYS = [
  {
    name: "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    required: true,
    unlocks: "Sign-up, log-in and every ride screen.",
    source: "Clerk dashboard → API Keys → Publishable key (pk_test_…).",
  },
  {
    name: "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    required: false,
    unlocks: "Paying for a ride (Confirm Ride / Schedule Ride).",
    source:
      "Stripe dashboard → Developers → API keys → Publishable key (pk_test_…).",
  },
  {
    name: "EXPO_PUBLIC_PLACES_API_KEY",
    required: false,
    unlocks: "Searching the From and To addresses.",
    source: "Google Cloud console → Places API key.",
  },
  {
    name: "EXPO_PUBLIC_DIRECTIONS_API_KEY",
    required: false,
    unlocks: "The route line on the booking map.",
    source: "Google Cloud console → Directions API key.",
  },
  {
    name: "EXPO_PUBLIC_GEOAPIFY_API_KEY",
    required: false,
    unlocks: "Map thumbnails in the ride history.",
    source: "geoapify.com → API key.",
  },
] as const satisfies readonly KeyInfo[];

/** The name of an EXPO_PUBLIC_* key the app reads. */
export type AppKeyName = (typeof APP_KEYS)[number]["name"];

/** One EXPO_PUBLIC_* key the app bundles, and what it is for. */
export interface AppKey extends KeyInfo {
  name: AppKeyName;
}

/** The app's keys as the bundle sees them (unset and empty are the same). */
export type AppKeyValues = Partial<Record<AppKeyName, string | undefined>>;

/** "set", "missing" (unset or empty), or "invalid" (set, but not a key of that kind). */
export type KeyStatus = "set" | "missing" | "invalid";

/** One key and its status. */
export interface AppKeyCheck extends AppKey {
  status: KeyStatus;
}

/**
 * Whether `key` is a Clerk publishable key, by the rule ClerkProvider throws on
 * (`isPublishableKey` in @clerk/shared 3.48): `pk_test_` or `pk_live_`, then
 * base64 of the Frontend API host followed by exactly one "$".
 */
export function isClerkPublishableKey(key: string): boolean {
  const parts = key.split("_");
  if (parts.length !== 3 || parts[0] !== "pk") return false;
  if (parts[1] !== "test" && parts[1] !== "live") return false;
  let decoded: string;
  try {
    decoded = atob(parts[2]);
  } catch {
    return false;
  }
  const host = decoded.slice(0, -1);
  return decoded.endsWith("$") && !host.includes("$") && host.includes(".");
}

/**
 * Whether `key` is a Stripe publishable key. A secret key (`sk_…`, `rk_…`)
 * pasted into the app's env would ship inside the bundle, so it counts as
 * not valid rather than as set.
 */
export const isStripePublishableKey = (key: string) =>
  /^pk_(test|live)_\S+$/.test(key);

const VALIDATORS: Partial<Record<AppKeyName, (key: string) => boolean>> = {
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: isClerkPublishableKey,
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: isStripePublishableKey,
};

/**
 * The status of one key's value, exactly as the bundle holds it: the value
 * that is checked is the value the SDK receives.
 */
export function keyStatus(
  name: AppKeyName,
  value: string | undefined,
): KeyStatus {
  if (!value) return "missing";
  const valid = VALIDATORS[name];
  return valid && !valid(value) ? "invalid" : "set";
}

/** Every app key with its status, in APP_KEYS order (EG1). */
export function checkAppKeys(values: AppKeyValues): AppKeyCheck[] {
  return APP_KEYS.map((key) => ({
    ...key,
    status: keyStatus(key.name, values[key.name]),
  }));
}

/** Whether the app can start: every required key is set and valid (EG1). */
export const canStart = (checks: AppKeyCheck[]) =>
  checks.every((check) => !check.required || check.status === "set");

/** At least this many characters, or quotes cannot be signed (server/quote-token.ts). */
export const QUOTE_SECRET_MIN_LENGTH = 32;

/** The server settings /(api)/health reports on, in the order it lists them (EG2). */
export const SERVER_SETTINGS = [
  {
    name: "DATABASE_URL",
    unlocks:
      "Drivers, rides and bookings: a Neon Postgres connection string, with schema.sql applied.",
  },
  {
    name: "CLERK_JWT_KEY",
    unlocks:
      "Checking who is signed in: Clerk dashboard → API Keys → JWT public key, on one line.",
  },
  {
    name: "QUOTE_SIGNING_SECRET",
    unlocks: `Prices: any random string of at least ${QUOTE_SECRET_MIN_LENGTH} characters (openssl rand -hex 32).`,
  },
  {
    name: "STRIPE_SECRET_KEY",
    unlocks:
      "Charging a booked ride: Stripe dashboard → Developers → API keys → Secret key (sk_test_…).",
  },
] as const satisfies readonly { name: string; unlocks: string }[];

/** The name of a server setting /(api)/health reports on. */
export type ServerSettingName = (typeof SERVER_SETTINGS)[number]["name"];

/** One setting the API routes read on the server, and what it is for. */
export interface ServerSetting {
  name: ServerSettingName;
  unlocks: string;
}

/** The server's settings as the API routes see them. */
export type ServerSettingValues = Partial<
  Record<ServerSettingName, string | undefined>
>;

const SERVER_SETTING_NAMES: readonly string[] = SERVER_SETTINGS.map(
  (setting) => setting.name,
);

/** Whether one setting's value can be used by the routes that read it. */
function usable(name: ServerSettingName, value: string | undefined): boolean {
  if (!value) return false;
  return (
    name !== "QUOTE_SIGNING_SECRET" || value.length >= QUOTE_SECRET_MIN_LENGTH
  );
}

/**
 * The server settings that are unset or unusable, by name, in SERVER_SETTINGS
 * order (EG2). A QUOTE_SIGNING_SECRET that is too short is listed exactly like
 * a missing one, so the answer says nothing about its length.
 */
export function missingServerSettings(
  values: ServerSettingValues,
): ServerSettingName[] {
  return SERVER_SETTINGS.map((setting) => setting.name).filter(
    (name) => !usable(name, values[name]),
  );
}

/** What GET /(api)/health answers (EG2). */
export interface HealthReport {
  ok: boolean;
  missing: ServerSettingName[];
}

/** The /(api)/health answer for these settings. */
export function healthReport(values: ServerSettingValues): HealthReport {
  const missing = missingServerSettings(values);
  return { ok: missing.length === 0, missing };
}

/**
 * The missing settings a /(api)/health body names, or null when the body is
 * not a health report at all (e.g. an HTML page from something else on that
 * address). Names the app does not know are dropped (EG3).
 */
export function readHealthReport(body: unknown): ServerSettingName[] | null {
  const missing = (body as { missing?: unknown } | null)?.missing;
  const ok = (body as { ok?: unknown } | null)?.ok;
  if (typeof ok !== "boolean" || !Array.isArray(missing)) return null;
  return missing.filter(
    (name): name is ServerSettingName =>
      typeof name === "string" && SERVER_SETTING_NAMES.includes(name),
  );
}
