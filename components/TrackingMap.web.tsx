import { useState } from "react";
import { Image, LayoutChangeEvent, Text, View } from "react-native";

import { icons } from "@/constants";
import { LatLng } from "@/lib/geo";
import { TrackedRide, TrackingSnapshot } from "@/lib/tracking";

// Positions and angles are computed, so these are style props, not classes:
// read the tokens themselves (as TrackingMap.tsx does for the route colour).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require("../tailwind.config").theme.extend;
const ROUTE_COLOR: string = colors.primary["500"];
const LEG_COLOR: string = colors.primary["300"];
const START_COLOR: string = colors.secondary["500"];
const GRID_COLOR: string = colors.primary["100"];

export const SIMULATED_LABEL =
  "Simulated position · map in the iOS and Android app";

/** The size of the map, from its layout. */
export interface Box {
  width: number;
  height: number;
}

/** Room left clear on each side, in px: the drawing stays inside the rest. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A point in the map, in px from its top-left corner. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Where track-ride's screen covers the map: RideLayout's back button and title
 * (top-16 + h-10) above and, below, the bottom sheet at rest: `coveredBottom`
 * of the map's height (track-ride passes its 45% snap point, to both maps).
 */
export function screenInsets(box: Box, coveredBottom: number): Insets {
  return {
    top: 112,
    right: 0,
    bottom: Math.round(box.height * coveredBottom),
    left: 0,
  };
}

/**
 * Projects coordinates into `box` minus `insets`: north up, one scale for both
 * axes (longitude shrunk by cos(latitude)), the points' bounds centred. When
 * every point coincides it sits in the middle.
 */
export function projector(
  points: LatLng[],
  box: Box,
  insets: Insets,
): (p: LatLng) => Point {
  const meanLat =
    points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const xs = points.map((p) => p.longitude * kx);
  const ys = points.map((p) => -p.latitude);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const width = Math.max(0, box.width - insets.left - insets.right);
  const height = Math.max(0, box.height - insets.top - insets.bottom);
  const scale = Math.min(
    maxX > minX ? width / (maxX - minX) : Infinity,
    maxY > minY ? height / (maxY - minY) : Infinity,
  );
  const k = Number.isFinite(scale) ? scale : 0;
  const cx = insets.left + width / 2;
  const cy = insets.top + height / 2;
  return (p) => ({
    x: cx + (p.longitude * kx - (minX + maxX) / 2) * k,
    y: cy + (-p.latitude - (minY + maxY) / 2) * k,
  });
}

/** A straight line between two points, `thickness` px wide. */
const Segment = ({
  from,
  to,
  color,
  thickness,
  testID,
}: {
  from: Point;
  to: Point;
  color: string;
  thickness: number;
  testID: string;
}) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (from.x + to.x) / 2 - length / 2,
        top: (from.y + to.y) / 2 - thickness / 2,
        width: length,
        height: thickness,
        borderRadius: thickness / 2,
        backgroundColor: color,
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
};

/** A circle of `size` px centred on `at`. */
const Dot = ({
  at,
  size,
  style,
  testID,
}: {
  at: Point;
  size: number;
  style: object;
  testID: string;
}) => (
  <View
    testID={testID}
    pointerEvents="none"
    style={{
      position: "absolute",
      left: at.x - size / 2,
      top: at.y - size / 2,
      width: size,
      height: size,
      borderRadius: size / 2,
      ...style,
    }}
  />
);

const PIN = { width: 26, height: 31 };
const CAR = 36;

/**
 * Where the route's points may land: the clear area less room for what is
 * drawn around them (the pin stands 31 px above its point, the car is 36 px
 * wide) and, at the bottom, the label's 40 px strip.
 */
export function drawingInsets(clear: Insets): Insets {
  return {
    top: clear.top + 40,
    right: clear.right + 32,
    bottom: clear.bottom + 56,
    left: clear.left + 32,
  };
}

/**
 * The web build's tracking map (R70: react-native-maps has no web version).
 * It draws what the native map shows, from the same ride and snapshot, on a
 * plain grid: the two straight legs (driver's start → pickup → destination,
 * ADR-010) and both pins (MP5), the car where the simulation puts it and the
 * line still ahead of it, as MP1–MP4 (MP6), labelled as simulated. It keeps
 * clear RideLayout's header and the `coveredBottom` share of its height that
 * the sheet covers (none by default, as on native); `insets` replaces both
 * (the README hero has neither).
 */
const TrackingMap = ({
  ride,
  snapshot,
  coveredBottom = 0,
  insets,
}: {
  ride: TrackedRide;
  snapshot: TrackingSnapshot;
  /** The share of the map's height the bottom sheet covers at rest (0–1). */
  coveredBottom?: number;
  insets?: Insets;
}) => {
  const [box, setBox] = useState<Box | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  };

  const clear = box && (insets ?? screenInsets(box, coveredBottom));
  const at =
    box &&
    clear &&
    projector(
      [ride.driverStart, ride.pickup, ride.destination],
      box,
      drawingInsets(clear),
    );

  const { phase } = snapshot;
  const moving =
    phase === "en_route" || phase === "arrived" || phase === "on_trip";
  const target = phase === "on_trip" ? ride.destination : ride.pickup;

  return (
    <View
      testID="tracking-map-web"
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Map: ${SIMULATED_LABEL}`}
      className="flex-1 overflow-hidden bg-general-600"
    >
      {box &&
        Array.from({ length: Math.ceil(box.width / 32) }, (_, i) => (
          <View
            key={`v${i}`}
            style={{
              position: "absolute",
              left: i * 32 + 16,
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: GRID_COLOR,
            }}
          />
        ))}
      {box &&
        Array.from({ length: Math.ceil(box.height / 32) }, (_, i) => (
          <View
            key={`h${i}`}
            style={{
              position: "absolute",
              top: i * 32 + 16,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: GRID_COLOR,
            }}
          />
        ))}
      {at && clear && (
        <>
          <Segment
            testID="tracking-leg-pickup"
            from={at(ride.driverStart)}
            to={at(ride.pickup)}
            color={LEG_COLOR}
            thickness={4}
          />
          <Segment
            testID="tracking-leg-destination"
            from={at(ride.pickup)}
            to={at(ride.destination)}
            color={LEG_COLOR}
            thickness={4}
          />
          {moving && (
            <Segment
              testID="tracking-route"
              from={at(snapshot.car)}
              to={at(target)}
              color={ROUTE_COLOR}
              thickness={4}
            />
          )}
          <Dot
            testID="tracking-start"
            at={at(ride.driverStart)}
            size={10}
            style={{ backgroundColor: START_COLOR }}
          />
          <Dot
            testID="tracking-pickup"
            at={at(ride.pickup)}
            size={18}
            style={{
              backgroundColor: "white",
              borderWidth: 4,
              borderColor: ROUTE_COLOR,
            }}
          />
          <Image
            testID="tracking-destination"
            source={icons.pin}
            resizeMode="contain"
            style={{
              position: "absolute",
              left: at(ride.destination).x - PIN.width / 2,
              top: at(ride.destination).y - PIN.height,
              width: PIN.width,
              height: PIN.height,
            }}
          />
          {phase !== "completed" && (
            <Image
              testID="tracking-car"
              source={icons.marker}
              resizeMode="contain"
              style={{
                position: "absolute",
                left: at(snapshot.car).x - CAR / 2,
                top: at(snapshot.car).y - CAR / 2,
                width: CAR,
                height: CAR,
                transform: [{ rotate: `${snapshot.headingDeg}deg` }],
              }}
            />
          )}
          <View
            testID="tracking-map-label"
            pointerEvents="none"
            // At the bottom of the clear area, just above the sheet.
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: clear.bottom + 12,
            }}
            className="items-center"
          >
            <Text className="text-xs font-JakartaMedium text-secondary-700 bg-white rounded-full px-3 py-1">
              {SIMULATED_LABEL}
            </Text>
          </View>
        </>
      )}
    </View>
  );
};

export default TrackingMap;
