/**
 * The layer rules of plan §8, proven against the real .eslintrc.js: each
 * snippet is linted as if it lived in the folder under test and must trip the
 * rule that guards that folder, on exactly the offending lines. Other rules
 * (prettier, import order) are filtered out; only the rule under test counts.
 */
import path from "path";

import appConfig from "../../app.config";
import { read, REPO_ROOT } from "../helpers/repo";

import type { ConfigContext } from "expo/config";

type LintMessage = {
  ruleId: string | null;
  line: number;
  message: string;
  severity: number;
  fatal?: boolean;
};
type LintResult = {
  filePath: string;
  errorCount: number;
  messages: LintMessage[];
};
type Linter = {
  lintText(
    code: string,
    options: { filePath: string; warnIgnored: boolean },
  ): Promise<LintResult[]>;
  lintFiles(patterns: string[]): Promise<LintResult[]>;
  isPathIgnored(filePath: string): Promise<boolean>;
};

jest.setTimeout(120_000);

const { ESLint } = require("eslint");
const eslint: Linter = new ESLint({ cwd: REPO_ROOT });

const ERROR = 2;
const PURE_CLOCK = "Pure code takes `nowMs` as a parameter.";
const RAW_HEX = "Use a tailwind.config.js colour token, not a raw hex class.";
const HEX_VALUE =
  "Read the colour from tailwind.config.js, not a raw hex value.";
const HERMES =
  "AbortSignal.timeout does not exist on Hermes (React Native's AbortSignal polyfill has no timeout, still in 0.86).";
const DEVICE_CLOCK =
  "Read wall-clock time via lib/zagreb-time.ts (Europe/Zagreb), never the device clock.";
const LIB_FRAMEWORK = "lib/ is pure: no React, React Native, Expo or Clerk.";
const LIB_LAYER = "lib/ is the bottom layer: nothing above it.";
const LIB_IO = "lib/ has no I/O: no Stripe, database or Node built-ins.";
const SERVER_ONLY = "Server-only code must never reach the app bundle.";
const SERVER_APP = "Server code must not import the app.";
const SERVER_CLIENT_SDK =
  "Server code runs on Node: no Expo, Clerk or Stripe React Native client SDK.";

const restricted = (source: string, why: string) =>
  `'${source}' import is restricted from being used by a pattern. ${why}`;
const propertyRestricted = (property: string) =>
  `'${property}' is restricted from being used. ${DEVICE_CLOCK}`;
const code = (...lines: string[]) => `${lines.join("\n")}\n`;

/** Lint `source` as the repo file `filePath`; fail loudly if it was ignored or did not parse. */
async function lint(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, {
    filePath,
    warnIgnored: true,
  });
  const unlinted = result.messages.filter((m) => m.fatal || m.ruleId === null);
  if (unlinted.length > 0) {
    throw new Error(`${filePath} was not linted: ${JSON.stringify(unlinted)}`);
  }
  return result.messages;
}

/** The `ruleId` reports for `source` placed at `filePath`, as `{ line, message }` errors. */
async function reports(filePath: string, source: string, ruleId: string) {
  return (await lint(filePath, source))
    .filter((m) => m.ruleId === ruleId)
    .map(({ line, message, severity }) => ({ line, message, severity }));
}

const error = (line: number, message: string) => ({
  line,
  message,
  severity: ERROR,
});

it("runs ESLint 8, whose eslintrc mode reads .eslintrc.js", () => {
  expect(ESLint.version).toMatch(/^8\./);
});

describe("lib/** is pure", () => {
  it("no-restricted-syntax: Date.now() and an argument-less new Date() are errors; new Date(ms) is not", async () => {
    const source = code(
      "export const nowMs = Date.now();",
      "export const today = new Date();",
      "export const epoch = new Date(0);",
    );

    expect(await reports("lib/x.ts", source, "no-restricted-syntax")).toEqual([
      error(1, PURE_CLOCK),
      error(2, PURE_CLOCK),
    ]);
  });

  it("no-restricted-imports: React, React Native, Expo, Clerk and every layer above lib/ are errors; lib/ itself is not", async () => {
    const source = code(
      'import { useAuth } from "@clerk/clerk-expo";',
      'import { router } from "expo-router";',
      'import { useState } from "react";',
      'import { View } from "react-native";',
      'import { RideCard } from "@/components/RideCard";',
      'import { useFetch } from "@/hooks/useFetch";',
      'import { sql } from "@/server/db";',
      'import { fetchAPI } from "@/services/api";',
      'import { useLocationStore } from "@/store";',
      'import { distanceKm } from "@/lib/geo";',
    );

    expect(await reports("lib/x.ts", source, "no-restricted-imports")).toEqual([
      error(1, restricted("@clerk/clerk-expo", LIB_FRAMEWORK)),
      error(2, restricted("expo-router", LIB_FRAMEWORK)),
      error(3, restricted("react", LIB_FRAMEWORK)),
      error(4, restricted("react-native", LIB_FRAMEWORK)),
      error(5, restricted("@/components/RideCard", LIB_LAYER)),
      error(6, restricted("@/hooks/useFetch", LIB_LAYER)),
      error(7, restricted("@/server/db", LIB_LAYER)),
      error(8, restricted("@/services/api", LIB_LAYER)),
      error(9, restricted("@/store", LIB_LAYER)),
    ]);
  });

  it("no-restricted-imports: Stripe, the database driver and Node built-ins (bare, node: or a subpath) are errors; a lib/ import is not", async () => {
    const source = code(
      'import Stripe from "stripe";',
      'import { neon } from "@neondatabase/serverless";',
      'import fs from "fs";',
      'import { readFile } from "fs/promises";',
      'import { createHash } from "node:crypto";',
      'import path from "path";',
      'import { distanceKm } from "@/lib/geo";',
    );

    expect(await reports("lib/x.ts", source, "no-restricted-imports")).toEqual([
      error(1, restricted("stripe", LIB_IO)),
      error(2, restricted("@neondatabase/serverless", LIB_IO)),
      error(3, restricted("fs", LIB_IO)),
      error(4, restricted("fs/promises", LIB_IO)),
      error(5, restricted("node:crypto", LIB_IO)),
      error(6, restricted("path", LIB_IO)),
    ]);
  });

  it("a pure function that takes nowMs passes every rule, not just the layer rules", async () => {
    const source = code(
      "/** Minutes left until `departAtMs`, measured at `nowMs`. */",
      "export function minutesUntil(departAtMs: number, nowMs: number): number {",
      "  return (departAtMs - nowMs) / 60_000;",
      "}",
    );

    expect(await lint("lib/x.ts", source)).toEqual([]);
  });
});

describe("the app bundle never imports server-only code", () => {
  const source = code(
    'import { neon } from "@neondatabase/serverless";',
    'import Stripe from "stripe";',
    'import { sql } from "@/server/db";',
    'import { formatEur } from "@/lib/utils";',
  );

  it.each([
    "components/X.tsx",
    "app/(root)/x.tsx",
    "app/(auth)/x.tsx",
    "app/_layout.tsx",
    "hooks/useX.ts",
    "services/x.ts",
    "store/x.ts",
  ])(
    "no-restricted-imports: %s may not import @/server/*, stripe or @neondatabase/serverless",
    async (filePath) => {
      expect(await reports(filePath, source, "no-restricted-imports")).toEqual([
        error(1, restricted("@neondatabase/serverless", SERVER_ONLY)),
        error(2, restricted("stripe", SERVER_ONLY)),
        error(3, restricted("@/server/db", SERVER_ONLY)),
      ]);
    },
  );
});

describe("app/** and components/** use tokens and Hermes-safe APIs", () => {
  it.each(["components/X.tsx", "app/(root)/x.tsx"])(
    "no-restricted-syntax: %s may not use a raw [#hex] class, in a string, a JSX className or a template",
    async (filePath) => {
      const source = code(
        'import { View } from "react-native";',
        "",
        'export const red = "bg-[#ff0000]";',
        'export const Red = () => <View className="text-[#FF0000]" />;',
        "export const tint = (size: string) => `text-${size} bg-[#00ff00]`;",
        'export const token = "bg-primary-500 text-general-400";',
      );

      expect(await reports(filePath, source, "no-restricted-syntax")).toEqual([
        error(3, RAW_HEX),
        error(4, RAW_HEX),
        error(5, RAW_HEX),
      ]);
    },
  );

  it.each(["components/X.tsx", "app/(root)/x.tsx"])(
    "no-restricted-syntax: %s may not pass a raw hex colour as a prop, a style value or a constant",
    async (filePath) => {
      const source = code(
        'import { ActivityIndicator, View } from "react-native";',
        "",
        'export const A = () => <ActivityIndicator color="#000" />;',
        'export const B = () => <ActivityIndicator color={"#0286ff"} />;',
        'export const C = () => <View style={{ backgroundColor: "#F5F5F5" }} />;',
        'export const shadow = { shadowColor: "#d4d4d480" };',
        'export const ROUTE_COLOR = "#0286FF";',
        'export const D = () => <ActivityIndicator color="black" testID="#1" />;',
        'export const byHex = { "#fff": "white", tag: "#hashtag" };',
      );

      expect(await reports(filePath, source, "no-restricted-syntax")).toEqual([
        error(3, HEX_VALUE),
        error(4, HEX_VALUE),
        error(5, HEX_VALUE),
        error(6, HEX_VALUE),
        error(7, HEX_VALUE),
      ]);
    },
  );

  it.each(["components/X.tsx", "services/x.ts"])(
    "no-restricted-syntax: %s may not call AbortSignal.timeout (missing on Hermes)",
    async (filePath) => {
      const source = code(
        "export const signal = AbortSignal.timeout(1000);",
        "export const controller = new AbortController();",
      );

      expect(await reports(filePath, source, "no-restricted-syntax")).toEqual([
        error(1, HERMES),
      ]);
    },
  );
});

describe("server code never imports the app", () => {
  it("no-restricted-imports: server/** may not import React, React Native or any app layer; lib/ is fine", async () => {
    const source = code(
      'import { useState } from "react";',
      'import { View } from "react-native";',
      'import { RideCard } from "@/components/RideCard";',
      'import { useFetch } from "@/hooks/useFetch";',
      'import { fetchAPI } from "@/services/api";',
      'import { useLocationStore } from "@/store";',
      'import { quoteTrip } from "@/lib/pricing";',
    );

    expect(
      await reports("server/x.ts", source, "no-restricted-imports"),
    ).toEqual([
      error(1, restricted("react", SERVER_APP)),
      error(2, restricted("react-native", SERVER_APP)),
      error(3, restricted("@/components/RideCard", SERVER_APP)),
      error(4, restricted("@/hooks/useFetch", SERVER_APP)),
      error(5, restricted("@/services/api", SERVER_APP)),
      error(6, restricted("@/store", SERVER_APP)),
    ]);
  });

  it("no-restricted-imports: an API route under app/(api)/ may not import React or a hook", async () => {
    const source = code(
      'import React from "react";',
      'import { useFetch } from "@/hooks/useFetch";',
    );

    expect(
      await reports("app/(api)/x+api.ts", source, "no-restricted-imports"),
    ).toEqual([
      error(1, restricted("react", SERVER_APP)),
      error(2, restricted("@/hooks/useFetch", SERVER_APP)),
    ]);
  });

  it.each(["server/x.ts", "app/(api)/y+api.ts"])(
    "no-restricted-imports: %s may not import an Expo, Clerk or Stripe React Native client SDK; their server SDKs are fine",
    async (filePath) => {
      const source = code(
        'import { useAuth } from "@clerk/clerk-expo";',
        'import { Ionicons } from "@expo/vector-icons";',
        'import { useStripe } from "@stripe/stripe-react-native";',
        'import { router } from "expo-router";',
        'import * as SecureStore from "expo-secure-store";',
        'import { createClerkClient } from "@clerk/backend";',
        'import { Expo } from "expo-server-sdk";',
        'import Stripe from "stripe";',
      );

      expect(await reports(filePath, source, "no-restricted-imports")).toEqual([
        error(1, restricted("@clerk/clerk-expo", SERVER_CLIENT_SDK)),
        error(2, restricted("@expo/vector-icons", SERVER_CLIENT_SDK)),
        error(3, restricted("@stripe/stripe-react-native", SERVER_CLIENT_SDK)),
        error(4, restricted("expo-router", SERVER_CLIENT_SDK)),
        error(5, restricted("expo-secure-store", SERVER_CLIENT_SDK)),
      ]);
    },
  );
});

describe("the tooling scripts are linted", () => {
  it("eslint . reaches scripts/*.mjs, which ESLint 8 skips unless an override names them, and each one is clean", async () => {
    const results = await eslint.lintFiles(["scripts"]);

    expect(
      results
        .map(({ filePath, errorCount }) => ({
          file: path.relative(REPO_ROOT, filePath).split(path.sep).join("/"),
          errorCount,
        }))
        .sort((a, b) => a.file.localeCompare(b.file)),
    ).toEqual([
      { file: "scripts/docs-shots.mjs", errorCount: 0 },
      { file: "scripts/gallery-inputs.mjs", errorCount: 0 },
      { file: "scripts/mutants.mjs", errorCount: 0 },
    ]);
  });
});

describe("wall-clock time only via lib/zagreb-time.ts", () => {
  const PROPERTIES = [
    "getHours",
    "getDay",
    "getDate",
    "getMonth",
    "getFullYear",
    "toLocaleString",
    "toLocaleDateString",
    "toLocaleTimeString",
  ];
  const source = code(
    ...PROPERTIES.map(
      (property) =>
        `export const ${property} = (date: Date) => date.${property}();`,
    ),
  );

  it.each(["app/(root)/x.tsx", "components/X.tsx", "lib/x.ts", "server/x.ts"])(
    "no-restricted-properties: %s may not read the device clock",
    async (filePath) => {
      expect(
        await reports(filePath, source, "no-restricted-properties"),
      ).toEqual(
        PROPERTIES.map((property, index) =>
          error(index + 1, propertyRestricted(property)),
        ),
      );
    },
  );

  it("no-restricted-properties is off under __tests__/**, where the TZ sentinel reads getHours", async () => {
    expect(
      await reports("__tests__/x.test.ts", source, "no-restricted-properties"),
    ).toEqual([]);
  });
});

describe("eslint-config-expo 57 on this app", () => {
  /** Each react-hooks report on `source` at `filePath`, as `{ rule, line, severity }`. */
  async function hookReports(filePath: string, source: string) {
    return (await lint(filePath, source))
      .filter((m) => m.ruleId?.startsWith("react-hooks/"))
      .map(({ ruleId, line, severity }) => ({ rule: ruleId, line, severity }));
  }

  it("the React Compiler-only react-hooks rules (refs, purity, immutability, set-state-in-effect) are off; rules-of-hooks stays an error and exhaustive-deps a warning", async () => {
    const source = code(
      'import { useEffect, useRef, useState } from "react";',
      'import { Text } from "react-native";',
      "",
      "export function Ticker({ id }: { id: string }) {",
      "  const renders = useRef(0);",
      "  renders.current += 1;",
      "  const [shownMs, setShownMs] = useState(0);",
      "  useEffect(() => {",
      "    setShownMs(0);",
      "    start();",
      "  }, [id]);",
      "  const start = () => setShownMs(1);",
      "  return <Text>{Date.now() + shownMs + renders.current}</Text>;",
      "}",
      "",
      "export function Broken({ id, on }: { id: string; on: boolean }) {",
      "  const [value, setValue] = useState(id);",
      "  if (on) useRef(id);",
      "  useEffect(() => setValue(id), []);",
      "  return <Text>{value}</Text>;",
      "}",
    );

    expect(await hookReports("components/X.tsx", source)).toEqual([
      { rule: "react-hooks/rules-of-hooks", line: 18, severity: ERROR },
      { rule: "react-hooks/exhaustive-deps", line: 19, severity: 1 },
    ]);
  });

  it("those rules may stay off only while the React Compiler does: the resolved app config enables no compiler", () => {
    const appJson = JSON.parse(read("app.json")).expo;
    const context = {
      projectRoot: REPO_ROOT,
      staticConfigPath: path.join(REPO_ROOT, "app.json"),
      packageJsonPath: path.join(REPO_ROOT, "package.json"),
      config: appJson,
    } as ConfigContext;

    expect(appConfig(context).experiments).toEqual({ typedRoutes: true });
  });

  it("@typescript-eslint/no-require-imports is off under __tests__/**, where jest.mock factories need require(); app code still gets its warning", async () => {
    const source = code(
      'jest.mock("@/services/api", () => require("./mocks/api"));',
      'export const api = require("@/services/api");',
    );
    const REQUIRE = "@typescript-eslint/no-require-imports";
    const warning = (line: number) => ({
      line,
      message: "A `require()` style import is forbidden.",
      severity: 1,
    });

    expect(await reports("__tests__/x.test.ts", source, REQUIRE)).toEqual([]);
    expect(await reports("__tests__/X.test.tsx", source, REQUIRE)).toEqual([]);
    expect(await reports("components/X.tsx", source, REQUIRE)).toEqual([
      warning(1),
      warning(2),
    ]);
  });

  it("eslint . skips the generated, gitignored files (expo-env.d.ts, coverage, build output) and nothing the layer rules cover", async () => {
    const ignored = async (files: string[]) => {
      const flags = await Promise.all(
        files.map((file) => eslint.isPathIgnored(path.join(REPO_ROOT, file))),
      );
      return files.filter((_, index) => flags[index]);
    };
    const generated = [
      "expo-env.d.ts",
      "coverage/lcov-report/sorter.js",
      "dist/index.js",
      "web-build/index.js",
    ];
    const covered = [
      "lib/x.ts",
      "server/x.ts",
      "app/(api)/x+api.ts",
      "app/(root)/x.tsx",
      "app/_layout.tsx",
      "components/X.tsx",
      "hooks/useX.ts",
      "services/x.ts",
      "store/x.ts",
      "scripts/x.mjs",
      "__tests__/x.test.ts",
      "nativewind-env.d.ts",
    ];

    expect(await ignored(generated)).toEqual(generated);
    expect(await ignored(covered)).toEqual([]);
  });
});
