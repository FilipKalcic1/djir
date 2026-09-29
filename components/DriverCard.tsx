import { Image, Text, TouchableOpacity, View } from "react-native";

import { icons } from "@/constants";
import { formatEur, formatMinutes } from "@/lib/utils";
import { DriverCardProps } from "@/types/type";

// An image's tint takes a colour, not a class: read the token itself.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require("../tailwind.config").theme.extend;
/** The check glyph is white: tinted, it shows on the selected card's pale blue. */
const CHECK_COLOR: string = colors.primary["500"];

/** One driver on the confirm list: rating, fare, pickup time, seats (R45, R74). */
const DriverCard = ({
  item,
  selected,
  setSelected,
  fareCents,
  hidePickupTime = false,
}: DriverCardProps) => {
  const isSelected = selected === item.id;
  const rating = Number(item.rating);
  return (
    <TouchableOpacity
      testID={`driver-card-${item.id}`}
      onPress={setSelected}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={`${item.title}, rated ${rating.toFixed(1)}`}
      className={`${
        isSelected
          ? "bg-general-600 border-primary-500"
          : "bg-white border-transparent"
      } border-2 flex flex-row items-center justify-between py-5 px-3 rounded-xl`}
    >
      <Image
        source={{ uri: item.profile_image_url ?? undefined }}
        className="w-14 h-14 rounded-full"
      />

      <View className="flex-1 flex flex-col items-start justify-center mx-3">
        <View className="flex flex-row items-center justify-start mb-1">
          <Text className="text-lg font-Jakarta">{item.title}</Text>
          <View className="flex flex-row items-center space-x-1 ml-2">
            <Image source={icons.star} className="w-3.5 h-3.5" />
            <Text testID="driver-rating" className="text-sm font-Jakarta">
              {rating.toFixed(1)}
            </Text>
          </View>
        </View>

        <View className="flex flex-row items-center justify-start">
          <Text testID="driver-fare" className="text-sm font-JakartaSemiBold">
            {fareCents === null ? "…" : formatEur(fareCents / 100)}
          </Text>
          {!hidePickupTime && (
            <>
              <Text className="text-sm font-Jakarta text-general-800 mx-1">
                |
              </Text>
              <Text
                testID="driver-pickup"
                className="text-sm font-Jakarta text-general-800"
              >
                {formatMinutes(item.pickupMinutes)} away
              </Text>
            </>
          )}
          <Text className="text-sm font-Jakarta text-general-800 mx-1">|</Text>
          <Text className="text-sm font-Jakarta text-general-800">
            {item.car_seats} seats
          </Text>
        </View>
      </View>

      {isSelected ? (
        <Image
          source={icons.checkmark}
          className="h-6 w-6"
          style={{ tintColor: CHECK_COLOR }}
          accessibilityLabel="Selected"
        />
      ) : (
        <Image
          source={{ uri: item.car_image_url ?? undefined }}
          className="h-14 w-14"
          resizeMode="contain"
        />
      )}
    </TouchableOpacity>
  );
};

export default DriverCard;
