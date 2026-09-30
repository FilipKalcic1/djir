import { ConfigContext, ExpoConfig } from "expo/config";

/**
 * A stand-in origin for `npx expo start` (EG4). expo-router's native fetch
 * polyfill (@expo/metro-runtime, location/install.native.ts) is installed only
 * when the origin is not `false`, and in a development bundle it then sends
 * every relative `/(api)/…` request to the dev server that served the bundle
 * (`getDevServer().url`), whatever this value is. It never reaches a release
 * build: only `expo start` sets NODE_ENV to "development" (`expo export` sets
 * "production", and the native build's embedded config sets nothing).
 */
export const DEV_SERVER_ORIGIN = "http://localhost:8081/";

/** The API origin: EXPO_PUBLIC_API_ORIGIN, else the dev stand-in, else `false` (R33, EG4). */
function apiOrigin(): string | false {
  if (process.env.EXPO_PUBLIC_API_ORIGIN) {
    return process.env.EXPO_PUBLIC_API_ORIGIN;
  }
  return process.env.NODE_ENV === "development" ? DEV_SERVER_ORIGIN : false;
}

/**
 * Build-time settings layered over app.json:
 *
 *  - R33: API routes are served from EXPO_PUBLIC_API_ORIGIN (per environment),
 *    never a hard-wired domain that session tokens could be sent to. Unset or
 *    empty, the origin is `false`: web still resolves `/(api)/…` against the
 *    page, but native builds fail closed, so they must set it.
 *  - EG4: …except under `npx expo start` (NODE_ENV "development"), where the
 *    origin is DEV_SERVER_ORIGIN, so Expo Go's `/(api)/…` calls reach the dev
 *    server without any EXPO_PUBLIC_API_ORIGIN.
 *  - R34: Android builds need their own Google Maps SDK key.
 *  - R59: the UI is designed light-only.
 *  - Ride reminders fire on time on Android 12–13 (exact alarms, ADR-012).
 *  - DJIR_GALLERY=1 (only `npm run docs:shots`) swaps the router root for
 *    docs/gallery/app: the README renders of the real components.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Djir",
  slug: config.slug ?? "djir",
  userInterfaceStyle: "light",
  android: {
    ...config.android,
    permissions: [
      ...(config.android?.permissions ?? []),
      "SCHEDULE_EXACT_ALARM",
    ],
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY },
    },
  },
  plugins: [
    ...(config.plugins ?? []).filter(
      (plugin) =>
        (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-router",
    ),
    [
      "expo-router",
      {
        origin: apiOrigin(),
        ...(process.env.DJIR_GALLERY === "1" && { root: "docs/gallery/app" }),
      },
    ],
    "expo-notifications",
  ],
});
