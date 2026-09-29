/**
 * Two test projects:
 *  - server: pure logic, server helpers, API routes, stores and the PGlite
 *    database tests, in plain Node (real WebCrypto, no React Native shims);
 *  - client: components, hooks and screens under jest-expo + Testing Library.
 *
 * `globalSetup` pins the whole run to America/Los_Angeles (see the file); the
 * sentinel test runs in BOTH projects, so neither can silently lose it.
 */
const shared = {
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
};
const SENTINEL = "<rootDir>/__tests__/*.test.ts";

/** The components whose states the build plan's tables gate (C1). */
const GATED_COMPONENTS = [
  "Payment",
  "TrackingSheet",
  "ScheduleModal",
  "RideCard",
  "ActiveRideBanner",
  "RideList",
];

module.exports = {
  globalSetup: "<rootDir>/jest.global-setup.js",
  projects: [
    {
      ...shared,
      displayName: "server",
      preset: "jest-expo/node",
      testMatch: [
        "lib",
        "server",
        "api",
        "db",
        "services",
        "store",
        "config",
        "meta",
      ]
        .map((dir) => `<rootDir>/__tests__/${dir}/**/*.test.ts`)
        .concat(SENTINEL),
    },
    {
      ...shared,
      displayName: "client",
      preset: "jest-expo/ios",
      testMatch: ["components", "hooks", "screens"]
        .map((dir) => `<rootDir>/__tests__/${dir}/**/*.test.ts?(x)`)
        .concat(SENTINEL),
      setupFilesAfterEnv: ["<rootDir>/__tests__/setup/client.ts"],
    },
  ],
  collectCoverageFrom: [
    "lib/**/*.ts",
    "server/**/*.ts",
    "services/**/*.ts",
    "hooks/**/*.ts",
    "store/**/*.ts",
    "app/**/*+api.ts",
    ...GATED_COMPONENTS.map((name) => `components/${name}.tsx`),
  ],
  coverageThreshold: {
    "./lib/": { lines: 100, branches: 95 },
    "./server/": { lines: 100, branches: 95 },
    "./app/**/*+api.ts": { lines: 100, branches: 95 },
    "./hooks/": { lines: 90 },
    "./services/": { lines: 90 },
    "./store/": { lines: 100 },
    ...Object.fromEntries(
      GATED_COMPONENTS.map((name) => [
        `./components/${name}.tsx`,
        { lines: 90, branches: 90 },
      ]),
    ),
  },
};
