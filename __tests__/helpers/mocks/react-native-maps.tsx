/**
 * react-native-maps as plain Views that keep their props, so a test can read
 * a marker's coordinate or a polyline's points, and a MapView whose ref
 * records camera moves in `animateToRegion` and `fitToCoordinates`
 * (`fireEvent(map, "mapReady")` is the native map reporting it can move):
 * `jest.mock("react-native-maps", () => require("../helpers/mocks/react-native-maps"))`.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import { View } from "react-native";

type ViewProps = React.ComponentProps<typeof View>;

/** Every `mapRef.current.animateToRegion(region, ms)` call. */
export const animateToRegion = jest.fn();
/** Every `mapRef.current.fitToCoordinates(points, { edgePadding, animated })` call. */
export const fitToCoordinates = jest.fn();

const MapView = forwardRef<unknown, ViewProps>((props, ref) => {
  useImperativeHandle(ref, () => ({ animateToRegion, fitToCoordinates }));
  return <View {...props} />;
});
MapView.displayName = "MapView";

export const Marker = (props: ViewProps) => <View {...props} />;
export const Polyline = (props: object) => <View {...props} />;
export const PROVIDER_DEFAULT = undefined;
export default MapView;

export function resetMaps() {
  animateToRegion.mockClear();
  fitToCoordinates.mockClear();
}
