import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import React, { useRef } from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import Map from "@/components/Map";
import { icons } from "@/constants";

interface RideLayoutProps {
  title: string;
  children: React.ReactNode;
  snapPoints?: string[];
  /** The map behind the sheet; the booking map by default. */
  map?: React.ReactNode;
  /**
   * Wrap the sheet in a scroll view. Pass false when the content is itself a
   * list (a FlatList must not sit inside a ScrollView) — R48.
   */
  scrollable?: boolean;
  onBack?: () => void;
}

/** A full-screen map with a back button, a title and a bottom sheet (Figma 8–14). */
const RideLayout = ({
  title,
  children,
  snapPoints = ["40%", "85%"],
  map = <Map />,
  scrollable = true,
  onBack = () => router.back(),
}: RideLayoutProps) => {
  const bottomSheetRef = useRef<BottomSheet>(null);

  return (
    <GestureHandlerRootView className="flex-1">
      <View className="flex-1 bg-white">
        <View className="flex flex-col h-screen bg-primary-500">
          <View className="flex flex-row absolute z-10 top-16 items-center justify-start px-5">
            <TouchableOpacity
              testID="ride-layout-back"
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <View className="w-10 h-10 bg-white rounded-full items-center justify-center">
                <Image
                  source={icons.backArrow}
                  resizeMode="contain"
                  className="w-6 h-6"
                />
              </View>
            </TouchableOpacity>
            <Text
              testID="ride-layout-title"
              accessibilityRole="header"
              className="text-xl font-JakartaSemiBold ml-5"
            >
              {title}
            </Text>
          </View>

          {map}
        </View>

        <BottomSheet
          ref={bottomSheetRef}
          snapPoints={snapPoints}
          index={0}
          // bottom-sheet v5 adds a snap point at the content's height unless
          // told not to; the sheet must rest where the screen says (MP7).
          enableDynamicSizing={false}
        >
          {scrollable ? (
            <BottomSheetScrollView
              testID="ride-layout-sheet"
              style={{ flex: 1, padding: 20 }}
              // The first tap on a place suggestion must select it, not just
              // dismiss the keyboard (R22).
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </BottomSheetScrollView>
          ) : (
            <BottomSheetView
              testID="ride-layout-sheet"
              style={{ flex: 1, padding: 20 }}
            >
              {children}
            </BottomSheetView>
          )}
        </BottomSheet>
      </View>
    </GestureHandlerRootView>
  );
};

export default RideLayout;
