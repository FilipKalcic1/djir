/**
 * docs/gallery — a web-only Expo Router root that renders the app's real
 * components with fixture data, for the README (plan WP6 D4). Built only by
 * `npm run docs:shots` (DJIR_GALLERY=1 switches the router root in
 * app.config.ts); none of it ships in the app.
 */
import { useFonts } from "expo-font";
import { Slot } from "expo-router";
import { useEffect, useState } from "react";

import { setServerTime } from "@/services/clock";

import { NOW } from "../fixtures";

// Components that read the server clock see the fixture's instant.
setServerTime(new Date(NOW).toISOString());

// Modals (components/AppModal, on React Native's Modal) are fixed to the
// viewport on the web; scripts/docs-shots.mjs captures each Shot in a viewport
// of exactly its size, so a modal covers the phone frame and nothing more.
// react-native-web's Modal moves focus into itself (a focus trap), onto the
// full-frame backdrop, and Chrome would draw its focus ring around the frame.
// Nothing in a still render is focused by a person, so no ring is drawn.
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = ":focus, :focus-visible { outline: none !important; }";
  document.head.appendChild(style);
}

export default function GalleryLayout() {
  // Rendered in the browser only, never by the static export: hydration keeps
  // the server's styles, and @gorhom/bottom-sheet v5 sizes its handle from the
  // window width at import, which is 0 on the server (no grab handle).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [loaded] = useFonts({
    "Jakarta-Bold": require("../../../assets/fonts/PlusJakartaSans-Bold.ttf"),
    "Jakarta-ExtraBold": require("../../../assets/fonts/PlusJakartaSans-ExtraBold.ttf"),
    "Jakarta-Medium": require("../../../assets/fonts/PlusJakartaSans-Medium.ttf"),
    Jakarta: require("../../../assets/fonts/PlusJakartaSans-Regular.ttf"),
    "Jakarta-SemiBold": require("../../../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
  });
  return loaded && mounted ? <Slot /> : null;
}
