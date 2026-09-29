import { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Build-time settings layered over app.json:
 *
 *  - R33: API routes are served from EXPO_PUBLIC_API_ORIGIN (per environment),
 *    never a hard-wired domain that session tokens could be sent to. Unset or
 *    empty, the origin is `false`: web still resolves `/(api)/…` against the
 *    page, but native builds fail closed, so they must set it.
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
        origin: process.env.EXPO_PUBLIC_API_ORIGIN || false,
        ...(process.env.DJIR_GALLERY === "1" && { root: "docs/gallery/app" }),
      },
    ],
    "expo-notifications",
  ],
});
