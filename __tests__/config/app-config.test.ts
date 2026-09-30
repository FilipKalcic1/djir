/**
 * app.config.ts layered over app.json (plan WP6 · Config). The plan proves
 * R33, R34 and R59 with `npx expo config`; here they are tests, so a
 * regression fails `npm test` instead of waiting for someone to run a command.
 * NODE_ENV is set per test the way Expo CLI sets it: "development" for
 * `expo start`, "production" for `expo export`, and nothing at all when a
 * native build embeds the config (expo-constants' getAppConfig script).
 */
import fs from "fs";
import path from "path";

import appConfig, { DEV_SERVER_ORIGIN } from "../../app.config";
import { REPO_ROOT } from "../helpers/repo";

import type { ConfigContext, ExpoConfig } from "expo/config";

const APP_JSON = path.join(REPO_ROOT, "app.json");
const ENV_KEYS = [
  "EXPO_PUBLIC_API_ORIGIN",
  "GOOGLE_MAPS_ANDROID_API_KEY",
  "DJIR_GALLERY",
  "NODE_ENV",
];
/** SDK 57 configures the splash screen through its config plugin. */
const SPLASH_SCREEN = [
  "expo-splash-screen",
  {
    image: "./assets/images/splash.png",
    resizeMode: "contain",
    backgroundColor: "#2F80ED",
    imageWidth: 200,
  },
];

/** A fresh copy of app.json's `expo` object, as Expo hands it to app.config.ts. */
const appJson = (): ExpoConfig =>
  JSON.parse(fs.readFileSync(APP_JSON, "utf8")).expo;

const resolveConfig = (config: Partial<ExpoConfig> = appJson()) => {
  const context: ConfigContext = {
    projectRoot: REPO_ROOT,
    staticConfigPath: APP_JSON,
    packageJsonPath: path.join(REPO_ROOT, "package.json"),
    config,
  };
  return appConfig(context);
};

const pluginName = (plugin: string | unknown[]) =>
  Array.isArray(plugin) ? plugin[0] : plugin;
const expoRouterEntries = (config: ExpoConfig) =>
  (config.plugins ?? []).filter(
    (plugin) => pluginName(plugin) === "expo-router",
  );

let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  savedEnv = process.env;
  process.env = { ...savedEnv };
  for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
  process.env = savedEnv;
});

describe("API origin (expo-router plugin)", () => {
  it("R33: serves API routes from EXPO_PUBLIC_API_ORIGIN, through exactly one expo-router entry", () => {
    process.env.EXPO_PUBLIC_API_ORIGIN = "https://staging.djir.example/";

    const config = resolveConfig();

    expect(expoRouterEntries(config)).toEqual([
      ["expo-router", { origin: "https://staging.djir.example/" }],
    ]);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "R33: sets no origin (false) when EXPO_PUBLIC_API_ORIGIN is %s, so no domain is hard-wired",
    (_, value) => {
      process.env.NODE_ENV = "production"; // expo export
      if (value !== undefined) process.env.EXPO_PUBLIC_API_ORIGIN = value;

      const config = resolveConfig();

      expect(expoRouterEntries(config)).toEqual([
        ["expo-router", { origin: false }],
      ]);
    },
  );

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "R33 EG4: under npx expo start (NODE_ENV development), an %s EXPO_PUBLIC_API_ORIGIN becomes the dev-server stand-in, so Expo Go's relative /(api) calls are not cut off",
    (_, value) => {
      process.env.NODE_ENV = "development";
      if (value !== undefined) process.env.EXPO_PUBLIC_API_ORIGIN = value;

      const config = resolveConfig();

      expect(DEV_SERVER_ORIGIN).toBe("http://localhost:8081/");
      expect(expoRouterEntries(config)).toEqual([
        ["expo-router", { origin: "http://localhost:8081/" }],
      ]);
    },
  );

  it.each([
    ["production (expo export)", "production"],
    ["test", "test"],
    ["unset (a native build's embedded config)", undefined],
  ] as const)(
    "R33 EG4: only development gets the stand-in — with NODE_ENV %s an empty origin stays false, so a release build fails closed",
    (_, nodeEnv) => {
      if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;

      const config = resolveConfig();

      expect(expoRouterEntries(config)).toEqual([
        ["expo-router", { origin: false }],
      ]);
    },
  );

  it("R33 EG4: a set EXPO_PUBLIC_API_ORIGIN wins in development too", () => {
    process.env.NODE_ENV = "development";
    process.env.EXPO_PUBLIC_API_ORIGIN = "https://staging.djir.example/";

    expect(expoRouterEntries(resolveConfig())).toEqual([
      ["expo-router", { origin: "https://staging.djir.example/" }],
    ]);
  });

  it("swaps the router root for docs/gallery/app only when DJIR_GALLERY=1 (npm run docs:shots)", () => {
    process.env.EXPO_PUBLIC_API_ORIGIN = "https://staging.djir.example/";
    process.env.DJIR_GALLERY = "1";
    const gallery = resolveConfig();
    process.env.DJIR_GALLERY = "true";
    const notGallery = resolveConfig();

    expect(expoRouterEntries(gallery)).toEqual([
      [
        "expo-router",
        { origin: "https://staging.djir.example/", root: "docs/gallery/app" },
      ],
    ]);
    expect(expoRouterEntries(notGallery)).toEqual([
      ["expo-router", { origin: "https://staging.djir.example/" }],
    ]);
  });

  it("R33: replaces every expo-router entry app.json declares and keeps the other plugins", () => {
    process.env.EXPO_PUBLIC_API_ORIGIN = "https://staging.djir.example/";
    const base = appJson();
    base.plugins = [
      ...(base.plugins ?? []),
      "expo-router",
      ["expo-font", { fonts: [] }],
      "expo-secure-store",
    ];

    const config = resolveConfig(base);

    expect(config.plugins).toEqual([
      SPLASH_SCREEN,
      ["expo-font", { fonts: [] }],
      "expo-secure-store",
      ["expo-router", { origin: "https://staging.djir.example/" }],
      "expo-notifications",
    ]);
  });
});

describe("Android", () => {
  it("R34: puts GOOGLE_MAPS_ANDROID_API_KEY into android.config.googleMaps.apiKey", () => {
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = "AIza-test-android-key";

    const config = resolveConfig();

    expect(config.android?.config?.googleMaps).toEqual({
      apiKey: "AIza-test-android-key",
    });
    expect(config.android?.adaptiveIcon).toEqual(
      appJson().android?.adaptiveIcon,
    );
  });

  it("R34: leaves the Maps key empty when the env var is unset (no key is committed)", () => {
    const config = resolveConfig();

    expect(config.android?.config?.googleMaps).toHaveProperty(
      "apiKey",
      undefined,
    );
  });

  it("adds SCHEDULE_EXACT_ALARM for ride reminders and keeps app.json's own permissions", () => {
    const base = appJson();
    const declared = base.android?.permissions ?? [];
    base.android = { ...base.android, permissions: [...declared, "VIBRATE"] };

    expect(resolveConfig().android?.permissions).toEqual([
      ...declared,
      "SCHEDULE_EXACT_ALARM",
    ]);
    expect(resolveConfig(base).android?.permissions).toEqual([
      ...declared,
      "VIBRATE",
      "SCHEDULE_EXACT_ALARM",
    ]);
  });
});

describe("app identity and appearance", () => {
  it("R59: forces userInterfaceStyle to light over app.json's automatic", () => {
    const base = appJson();
    expect(base.userInterfaceStyle).toBe("automatic");

    expect(resolveConfig(base).userInterfaceStyle).toBe("light");
  });

  it("registers the expo-notifications plugin once", () => {
    const config = resolveConfig();

    expect(
      (config.plugins ?? []).filter(
        (plugin) => pluginName(plugin) === "expo-notifications",
      ),
    ).toEqual(["expo-notifications"]);
  });

  it("keeps app.json's name, slug, scheme and every other field it does not own", () => {
    const base = appJson();

    const config = resolveConfig(base);

    expect(config).toMatchObject({
      name: "Djir",
      slug: "djir",
      scheme: "djir",
      version: base.version,
      orientation: base.orientation,
      icon: base.icon,
      ios: base.ios,
      web: base.web,
      experiments: base.experiments,
    });
  });

  it("keeps the splash screen as app.json's expo-splash-screen plugin, which replaced the top-level splash key in SDK 57", () => {
    const base = appJson();

    const config = resolveConfig(base);

    expect(base).not.toHaveProperty("splash");
    expect(config).not.toHaveProperty("splash");
    expect(
      (config.plugins ?? []).filter(
        (plugin) => pluginName(plugin) === "expo-splash-screen",
      ),
    ).toEqual([SPLASH_SCREEN]);
  });

  it("names the app Djir / djir when app.json omits name and slug", () => {
    const base: Partial<ExpoConfig> = appJson();
    delete base.name;
    delete base.slug;

    const config = resolveConfig(base);

    expect(config.name).toBe("Djir");
    expect(config.slug).toBe("djir");
  });

  it("builds the plugins, permissions and Maps key from scratch when app.json declares none", () => {
    process.env.EXPO_PUBLIC_API_ORIGIN = "https://staging.djir.example/";
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = "AIza-test-android-key";

    const config = resolveConfig({});

    expect(config.plugins).toEqual([
      ["expo-router", { origin: "https://staging.djir.example/" }],
      "expo-notifications",
    ]);
    expect(config.android).toEqual({
      permissions: ["SCHEDULE_EXACT_ALARM"],
      config: { googleMaps: { apiKey: "AIza-test-android-key" } },
    });
  });
});
