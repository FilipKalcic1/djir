/**
 * docs/gallery — a web-only Expo Router root that renders the app's real
 * components with fixture data, for the README (plan WP6 D4). Built only by
 * `npm run docs:shots` (DJIR_GALLERY=1 switches the router root in
 * app.config.ts); none of it ships in the app.
 */
import { useFonts } from "expo-font";
import { Slot } from "expo-router";
import { ReactNativeModal } from "react-native-modal";

import { setServerTime } from "@/services/clock";

import { NOW } from "../fixtures";
import { SHOT_HEIGHT, SHOT_WIDTH } from "../Shot";

// Components that read the server clock see the fixture's instant.
setServerTime(new Date(NOW).toISOString());

// Modals open at once, inside the phone frame being captured (a Shot), not
// over the whole page.
Object.assign(ReactNativeModal.defaultProps ?? {}, {
  animationIn: "fadeIn",
  animationInTiming: 1,
  backdropTransitionInTiming: 1,
  coverScreen: false,
  deviceWidth: SHOT_WIDTH,
  deviceHeight: SHOT_HEIGHT,
});

export default function GalleryLayout() {
  const [loaded] = useFonts({
    "Jakarta-Bold": require("../../../assets/fonts/PlusJakartaSans-Bold.ttf"),
    "Jakarta-ExtraBold": require("../../../assets/fonts/PlusJakartaSans-ExtraBold.ttf"),
    "Jakarta-Medium": require("../../../assets/fonts/PlusJakartaSans-Medium.ttf"),
    Jakarta: require("../../../assets/fonts/PlusJakartaSans-Regular.ttf"),
    "Jakarta-SemiBold": require("../../../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
  });
  return loaded ? <Slot /> : null;
}
