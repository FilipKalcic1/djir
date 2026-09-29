/** The design tokens, read from tailwind.config.js, so style assertions name tokens, not hex. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require("../../tailwind.config");

export const colors: Record<string, Record<string, string>> = config.theme
  .extend.colors;
