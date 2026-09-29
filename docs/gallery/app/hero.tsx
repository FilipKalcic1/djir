import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import TrackingMap from "@/components/TrackingMap.web";
import TrackingSheet from "@/components/TrackingSheet";

import { HERO_FRAMES, live, NOW, sheetState, trackingAt } from "../fixtures";
import { Shot } from "../Shot";

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The README's hero: not a screen of the app, but its two tracking components
 * side by side, wide: the web tracking map and the sheet, for `live` at NOW
 * (or at `?at=`, for the frames of the animation: the whole ride).
 */
export default function Hero() {
  const { at } = useLocalSearchParams<{ at?: string }>();
  const nowMs = at ? Number(at) : NOW;
  const { tracked, snapshot } = trackingAt(live, nowMs);
  return (
    <Shot width={800} height={548} frames={HERO_FRAMES}>
      <View className="flex-1 flex-row bg-general-600">
        <View className="flex-1">
          <TrackingMap ride={tracked} snapshot={snapshot} insets={NO_INSETS} />
        </View>
        <View
          style={{ width: 360 }}
          className="bg-white rounded-3xl my-5 mr-5 px-5 pt-6"
        >
          <TrackingSheet
            state={sheetState(live, nowMs)}
            onBackHome={() => {}}
          />
        </View>
      </View>
    </Shot>
  );
}
