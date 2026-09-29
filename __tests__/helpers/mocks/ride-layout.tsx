/**
 * components/RideLayout for screen tests: its map (if the screen passes one)
 * and its content in a plain View, without the bottom sheet or the native map:
 * `jest.mock("@/components/RideLayout", () => require("../helpers/mocks/ride-layout"))`.
 */
import React from "react";
import { View } from "react-native";

const RideLayout = ({
  map,
  children,
}: {
  map?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <View>
    {map}
    {children}
  </View>
);

export default RideLayout;
