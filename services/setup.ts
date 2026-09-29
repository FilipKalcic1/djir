/**
 * services/setup.ts — the app's own keys, and the API's view of its settings
 * (EG1, EG3), for the "Setup needed" screen.
 */

import { AppKeyValues, readHealthReport, ServerSettingName } from "@/lib/setup";
import { fetchAPI } from "@/services/api";

/**
 * The EXPO_PUBLIC_* keys as the bundle holds them. Each one is read as
 * `process.env.NAME` itself: Expo inlines those member expressions and
 * nothing else, so a key read by a computed name would always be missing.
 */
export const appKeyValues = (): AppKeyValues => ({
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_PLACES_API_KEY: process.env.EXPO_PUBLIC_PLACES_API_KEY,
  EXPO_PUBLIC_DIRECTIONS_API_KEY: process.env.EXPO_PUBLIC_DIRECTIONS_API_KEY,
  EXPO_PUBLIC_GEOAPIFY_API_KEY: process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY,
});

/** How long the health check may take before the API counts as unreachable. */
export const HEALTH_TIMEOUT_MS = 8000;

/** What the app learnt from GET /(api)/health. */
export type ServerHealth =
  | { reachable: true; missing: ServerSettingName[] }
  | { reachable: false; reason: string };

/** The reason shown when the API answered, but not with a health report. */
export const NOT_A_HEALTH_REPORT =
  "Something answered at /(api)/health, but not the Djir API.";

/**
 * Ask the API which server settings are missing (EG3). Never throws: a
 * network error, a timeout or an error status means the API is unreachable,
 * with the reason to show.
 */
export async function fetchServerHealth(): Promise<ServerHealth> {
  let body: unknown;
  try {
    body = await fetchAPI<unknown>("/(api)/health", {
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message;
    return {
      reachable: false,
      reason:
        typeof message === "string" && message
          ? message
          : "The request failed.",
    };
  }
  const missing = readHealthReport(body);
  return missing === null
    ? { reachable: false, reason: NOT_A_HEALTH_REPORT }
    : { reachable: true, missing };
}
