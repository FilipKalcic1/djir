import { useEffect, useRef } from "react";
import { View } from "react-native";

import RideLayout from "@/components/RideLayout";
import TrackingMap from "@/components/TrackingMap.web";
import TrackingSheet from "@/components/TrackingSheet";
import { Ride } from "@/types/type";

import { sheetState, trackingAt } from "./fixtures";

export const SHOT_WIDTH = 390;
export const SHOT_HEIGHT = 844; // an iPhone 14's screen, in points

/** One frame of an animated render: the page's query string, and how long it shows. */
export interface Frame {
  query: string;
  ms: number;
}

/**
 * One README render: a `width` × `height` frame (a 390 × 844 phone screen by
 * default). It reports its size on the <body> for scripts/docs-shots.mjs,
 * which captures exactly that box, and, with `frames`, the pages to capture
 * as an animation after it.
 */
export const Shot = ({
  width = SHOT_WIDTH,
  height = SHOT_HEIGHT,
  frames,
  children,
}: {
  width?: number;
  height?: number;
  frames?: Frame[];
  children: React.ReactNode;
}) => {
  const ref = useRef<View>(null);
  useEffect(() => {
    // On react-native-web a View's ref is its DOM element.
    const node = ref.current as unknown as HTMLElement | null;
    const report = () => {
      if (node) {
        const { width: w, height: h } = node.getBoundingClientRect();
        document.body.dataset.shotWidth = String(Math.ceil(w));
        document.body.dataset.shotHeight = String(Math.ceil(h));
        if (frames) document.body.dataset.shotFrames = JSON.stringify(frames);
      }
    };
    report();
    const id = setInterval(report, 250);
    return () => clearInterval(id);
  }, [frames]);

  return (
    <View
      ref={ref}
      style={{ width, height, overflow: "hidden" }}
      className="bg-general-500"
    >
      {children}
    </View>
  );
};

/** Where track-ride.tsx's sheet rests, in % of the screen (its first snap point). */
const SHEET_REST_PERCENT = 45;

/**
 * track-ride.tsx as the web build draws it, and as the rider first sees it:
 * the real RideLayout (header, map, bottom sheet) with track-ride's snap
 * points, the sheet at rest (45%, 380 px), the web tracking map told what the
 * sheet covers, and the TrackingSheet for `ride` at `nowMs`. What lies below
 * the fold (S4's Cancel ride, say) stays there, as on a device.
 */
export const TrackingShot = ({
  ride,
  nowMs,
  onCancel,
}: {
  ride: Ride;
  nowMs: number;
  onCancel?: () => void;
}) => {
  const { tracked, snapshot } = trackingAt(ride, nowMs);
  return (
    <Shot>
      <RideLayout
        title="Your Ride"
        snapPoints={[`${SHEET_REST_PERCENT}%`, "85%"]}
        onBack={() => {}}
        map={
          <TrackingMap
            ride={tracked}
            snapshot={snapshot}
            coveredBottom={SHEET_REST_PERCENT / 100}
          />
        }
      >
        <TrackingSheet
          state={sheetState(ride, nowMs)}
          onBackHome={() => {}}
          onCancel={onCancel}
        />
      </RideLayout>
    </Shot>
  );
};
