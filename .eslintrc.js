// https://docs.expo.dev/guides/using-eslint/
// The layer rules below are the coding-style guide (docs/BUILD_PLAN.md §8),
// enforced rather than hoped for.
const { builtinModules } = require("module");

const DEVICE_CLOCK = [
  "getHours",
  "getDay",
  "getDate",
  "getMonth",
  "getFullYear",
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
].map((property) => ({
  property,
  message:
    "Read wall-clock time via lib/zagreb-time.ts (Europe/Zagreb), never the device clock.",
}));

const RAW_HEX = /\[#[0-9a-fA-F]{3,8}\]/.source;
const HEX_COLOUR = /^#[0-9a-fA-F]{3,8}$/.source;
const HEX_CLASS_MESSAGE =
  "Use a tailwind.config.js colour token, not a raw hex class.";
const HEX_VALUE_MESSAGE =
  "Read the colour from tailwind.config.js, not a raw hex value.";
/** Where a colour string reaches a component: a prop, a style key, a constant. */
const HEX_VALUES = [
  `JSXAttribute > Literal[value=/${HEX_COLOUR}/]`,
  `JSXAttribute > JSXExpressionContainer > Literal[value=/${HEX_COLOUR}/]`,
  `Property > Literal.value[value=/${HEX_COLOUR}/]`,
  `VariableDeclarator > Literal.init[value=/${HEX_COLOUR}/]`,
].map((selector) => ({ selector, message: HEX_VALUE_MESSAGE }));

module.exports = {
  extends: ["expo", "prettier"],
  plugins: ["prettier", "import"],
  rules: {
    "prettier/prettier": "error",
    "import/order": [
      "error",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index",
          "object",
          "type",
        ],
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      },
    ],
    "no-restricted-properties": ["error", ...DEVICE_CLOCK],
  },
  overrides: [
    {
      // Pure logic: no framework, no I/O, no hidden clock.
      files: ["lib/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["react", "react-*", "expo*", "@clerk/*"],
                message: "lib/ is pure: no React, React Native, Expo or Clerk.",
              },
              {
                group: [
                  "@/services/*",
                  "@/hooks/*",
                  "@/components/*",
                  "@/server/*",
                  "@/store",
                ],
                message: "lib/ is the bottom layer: nothing above it.",
              },
              {
                group: [
                  "stripe",
                  "@neondatabase/serverless",
                  "node:*",
                  ...builtinModules,
                ],
                message:
                  "lib/ has no I/O: no Stripe, database or Node built-ins.",
              },
            ],
          },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "CallExpression[callee.object.name='Date'][callee.property.name='now']",
            message: "Pure code takes `nowMs` as a parameter.",
          },
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message: "Pure code takes `nowMs` as a parameter.",
          },
        ],
      },
    },
    {
      // Everything that ships in the app bundle.
      files: [
        "app/(root)/**",
        "app/(auth)/**",
        "app/*.tsx",
        "components/**",
        "hooks/**",
        "services/**",
        "store/**",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@/server/*", "stripe", "@neondatabase/serverless"],
                message: "Server-only code must never reach the app bundle.",
              },
            ],
          },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector: `Literal[value=/${RAW_HEX}/]`,
            message: HEX_CLASS_MESSAGE,
          },
          {
            selector: `TemplateElement[value.raw=/${RAW_HEX}/]`,
            message: HEX_CLASS_MESSAGE,
          },
          ...HEX_VALUES,
          {
            selector:
              "MemberExpression[object.name='AbortSignal'][property.name='timeout']",
            message:
              "AbortSignal.timeout does not exist on Hermes (React Native 0.74).",
          },
        ],
      },
    },
    {
      // Server code: API routes and their helpers.
      files: ["server/**", "app/(api)/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "react",
                  "react-native*",
                  "@/components/*",
                  "@/hooks/*",
                  "@/services/*",
                  "@/store",
                ],
                message: "Server code must not import the app.",
              },
              {
                // Each of these pulls in react-native and breaks the Node API
                // bundle at runtime. The server SDKs of the same vendors are fine.
                group: [
                  "expo*",
                  "!expo-server-sdk",
                  "@expo/*",
                  "@stripe/stripe-react-native",
                  "@clerk/*",
                  "!@clerk/backend",
                ],
                message:
                  "Server code runs on Node: no Expo, Clerk or Stripe React Native client SDK.",
              },
            ],
          },
        ],
      },
    },
    {
      // Node tooling (npm run mutants, npm run docs:shots). ESLint 8's `eslint .`
      // (what `expo lint` runs) only lints .js and the files an override names,
      // so without this entry the scripts were never linted.
      files: ["scripts/**/*.mjs"],
      env: { node: true },
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
    },
    {
      files: ["__tests__/**", "jest.*.js"],
      env: { jest: true },
      rules: { "no-restricted-properties": "off" },
    },
  ],
};
