/**
 * react-native-modal for client tests: a visible modal renders its children,
 * plus two plain Pressables that stand for the backdrop and Android's back
 * button, so a test can tap them:
 * `jest.mock("react-native-modal", () => require("../helpers/mocks/react-native-modal"))`.
 */
import React from "react";
import { Pressable, View } from "react-native";

export const ReactNativeModal = ({
  isVisible,
  onBackdropPress,
  onBackButtonPress,
  children,
}: {
  isVisible: boolean;
  onBackdropPress?: () => void;
  onBackButtonPress?: () => void;
  children: React.ReactNode;
}) =>
  isVisible ? (
    <View>
      <Pressable testID="modal-backdrop" onPress={onBackdropPress} />
      <Pressable testID="modal-back-button" onPress={onBackButtonPress} />
      {children}
    </View>
  ) : null;
