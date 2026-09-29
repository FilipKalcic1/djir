import { Image, Text, View } from "react-native";

import { icons } from "@/constants";

/** Pickup and drop-off rows, as in Figma 12 and 14. */
const RouteSummary = ({
  origin,
  destination,
}: {
  origin: string | null;
  destination: string | null;
}) => (
  <View className="flex flex-col w-full mt-5">
    <View
      testID="route-summary-origin"
      className="flex flex-row items-center border-t border-b border-general-700 w-full py-3"
    >
      <Image
        source={icons.to}
        className="w-6 h-6"
        accessibilityLabel="Pickup"
      />
      <Text className="text-lg font-Jakarta ml-2 flex-1" numberOfLines={2}>
        {origin ?? "—"}
      </Text>
    </View>
    <View
      testID="route-summary-destination"
      className="flex flex-row items-center border-b border-general-700 w-full py-3"
    >
      <Image
        source={icons.point}
        className="w-6 h-6"
        accessibilityLabel="Drop-off"
      />
      <Text className="text-lg font-Jakarta ml-2 flex-1" numberOfLines={2}>
        {destination ?? "—"}
      </Text>
    </View>
  </View>
);

export default RouteSummary;
