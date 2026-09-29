import { useEffect, useRef } from "react";
import { Image, useWindowDimensions, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";

import { icons } from "@/constants";
import { LatLng } from "@/lib/geo";
import { regionCorners, regionFor } from "@/lib/map";
import { RidePhase, TrackedRide, TrackingSnapshot } from "@/lib/tracking";

// react-native-maps takes a colour string, not a class: read the token itself.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require("../tailwind.config").theme.extend;
const ROUTE_COLOR: string = colors.primary["500"];

/** What the map shows in each phase (the per-phase map table of the plan). */
export function mapScene(ride: TrackedRide, snapshot: TrackingSnapshot) {
  const { phase } = snapshot;
  const moving =
    phase === "en_route" || phase === "arrived" || phase === "on_trip";
  const parked = phase === "scheduled" || phase === "cancelled";
  const toDestination = phase === "on_trip";
  const pin: LatLng =
    phase === "on_trip" || phase === "completed"
      ? ride.destination
      : ride.pickup;
  return {
    car: parked ? ride.driverStart : moving ? snapshot.car : null,
    line: moving
      ? [snapshot.car, toDestination ? ride.destination : ride.pickup]
      : null,
    pin,
  };
}

/** RideLayout's back button and title: top-16 (64 px) + h-10 (40 px), and a gap. */
export const HEADER_INSET_PX = 112;
/** Room kept around the framed area, so the car and pin icons are never cut. */
export const FRAME_MARGIN_PX = 32;

/**
 * The edges the camera keeps the car and its target inside: below the header,
 * above the bottom sheet (`coveredBottom` of a map `heightPx` tall), and a
 * margin in from each side.
 */
export function frameInsets(heightPx: number, coveredBottom: number) {
  return {
    top: HEADER_INSET_PX + FRAME_MARGIN_PX,
    right: FRAME_MARGIN_PX,
    bottom: Math.round(heightPx * coveredBottom) + FRAME_MARGIN_PX,
    left: FRAME_MARGIN_PX,
  };
}

/** The live-tracking map (Figma 14): one car, one line, one pin. */
const TrackingMap = ({
  ride,
  snapshot,
  coveredBottom = 0,
}: {
  ride: TrackedRide;
  snapshot: TrackingSnapshot;
  /** The share of the map's height the bottom sheet covers at rest (0–1). */
  coveredBottom?: number;
}) => {
  const mapRef = useRef<MapView>(null);
  const ready = useRef(false);
  const { height } = useWindowDimensions(); // RideLayout's map is h-screen
  const scene = mapScene(ride, snapshot);

  // Car and target in view — in the part of the map the sheet leaves clear.
  const frame = (animated: boolean) => {
    const points = [scene.pin, ...(scene.car ? [scene.car] : [])];
    mapRef.current?.fitToCoordinates(regionCorners(points), {
      edgePadding: frameInsets(height, coveredBottom),
      animated,
    });
  };

  // Re-frame on phase change only (not every tick), once the map can move.
  const phase: RidePhase = snapshot.phase;
  useEffect(() => {
    if (ready.current) frame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <MapView
      ref={mapRef}
      testID="tracking-map"
      onMapReady={() => {
        ready.current = true;
        frame(false); // the first frame, as soon as the map has its size
      }}
      provider={PROVIDER_DEFAULT}
      className="w-full h-full"
      mapType="mutedStandard"
      showsPointsOfInterest={false}
      showsUserLocation={false}
      userInterfaceStyle="light"
      initialRegion={regionFor([scene.pin, ride.driverStart], { padding: 1.8 })}
    >
      {scene.line && (
        <Polyline
          testID="tracking-route"
          coordinates={scene.line}
          strokeColor={ROUTE_COLOR}
          strokeWidth={3}
        />
      )}
      <Marker testID="tracking-pin" coordinate={scene.pin} image={icons.pin} />
      {scene.car && (
        <Marker
          testID="tracking-car"
          coordinate={scene.car}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges
        >
          {/* Rotate a child image: Marker `rotation` is ignored by Apple Maps. */}
          <View
            style={{ transform: [{ rotate: `${snapshot.headingDeg}deg` }] }}
          >
            <Image
              source={icons.marker}
              style={{ width: 40, height: 40 }}
              resizeMode="contain"
            />
          </View>
        </Marker>
      )}
    </MapView>
  );
};

export default TrackingMap;
