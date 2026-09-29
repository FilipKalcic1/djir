/**
 * Tailwind for the web build (`npm run web:css`) and the README renders
 * (scripts/docs-shots.mjs): the app's config with every utility !important.
 * On the web, NativeWind v2 passes `className` through as CSS classes, and
 * react-native-web adds its own atomic classes and inline sizes later (a
 * require()d image gets its file's pixel size inline), so a plain `w-6 h-6`
 * would lose. !important gives the web what NativeWind gives iOS and Android.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require("./tailwind.config");

module.exports = { ...app, important: true };
