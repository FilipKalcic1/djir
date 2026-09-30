/**
 * components/RideLayout for screen tests: its map (if the screen passes one),
 * a plain back button (`ride-layout-back`, calling the screen's `onBack`) and
 * its content in a plain View, without the bottom sheet or the native map:
 * `jest.mock("@/components/RideLayout", () => require("../helpers/mocks/ride-layout"))`.
 */
import React from "react";
import { Pressable, View } from "react-native";

const RideLayout = ({
  map,
  onBack,
  children,
}: {
  map?: React.ReactNode;
  onBack?: () => void;
  children: React.ReactNode;
}) => (
  <View>
    <Pressable testID="ride-layout-back" onPress={onBack} />
    {map}
    {children}
  </View>
);

export default RideLayout;
