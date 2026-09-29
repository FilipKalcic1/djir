import { Image, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import RideStatusBadge from "@/components/RideStatusBadge";
import { icons } from "@/constants";
import { formatRideTime, RideStatus } from "@/lib/rides";
import { formatEur, placeName } from "@/lib/utils";
import { Ride } from "@/types/type";

interface RideCardProps {
  ride: Ride;
  status: RideStatus;
  /** Opens the ride: Track (Live) or View ride (Upcoming). */
  onOpen?: (ride: Ride) => void;
}

const GEOAPIFY_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;

/** The destination's map thumbnail, or null without a key (never `apiKey=undefined`). */
export const staticMapUrl = (ride: Ride, apiKey = GEOAPIFY_KEY) =>
  apiKey
    ? `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=400&center=lonlat:${ride.destination_longitude},${ride.destination_latitude}&zoom=14&apiKey=${apiKey}`
    : null;

const Row = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <View className="flex flex-row items-center w-full justify-between mb-4">
    <Text className="text-base font-JakartaMedium text-gray-500">{label}</Text>
    {children}
  </View>
);

/** One ride in history (states H1–H5 of the build plan). */
const RideCard = ({ ride, status, onOpen }: RideCardProps) => {
  const refunded = ride.payment_status === "refunded";
  const mapUrl = staticMapUrl(ride);
  // A screen reader lists buttons out of context: say which ride each opens (R74).
  const destination = placeName(ride.destination_address);
  return (
    <View
      testID={`ride-card-${ride.ride_id}`}
      className="flex flex-col bg-white rounded-lg shadow-sm shadow-neutral-300 mb-3 p-3"
    >
      <View className="flex flex-row items-center">
        {mapUrl ? (
          <Image
            source={{ uri: mapUrl }}
            className="w-[80px] h-[90px] rounded-lg"
            accessibilityLabel="Map of the destination"
          />
        ) : (
          <View
            testID="ride-card-map-placeholder"
            className="w-[80px] h-[90px] rounded-lg bg-general-600 items-center justify-center"
          >
            <Image source={icons.point} className="w-7 h-7" />
          </View>
        )}
        <View className="flex flex-col mx-5 gap-y-4 flex-1">
          <RideStatusBadge badge={status.badge} />
          <View className="flex flex-row items-center gap-x-2">
            <Image source={icons.to} className="w-5 h-5" />
            <Text
              className="text-base font-JakartaMedium flex-1"
              numberOfLines={1}
            >
              {ride.origin_address}
            </Text>
          </View>
          <View className="flex flex-row items-center gap-x-2">
            <Image source={icons.point} className="w-5 h-5" />
            <Text
              className="text-base font-JakartaMedium flex-1"
              numberOfLines={1}
            >
              {ride.destination_address}
            </Text>
          </View>
        </View>
      </View>

      <View className="flex flex-col w-full mt-4 bg-general-500 rounded-lg p-3">
        <Row label="Date & Time">
          <Text
            testID="ride-card-time"
            className="text-base font-JakartaBold"
            numberOfLines={1}
          >
            {formatRideTime(ride)}
          </Text>
        </Row>
        <Row label="Driver">
          <Text className="text-base font-JakartaBold">
            {ride.driver.first_name} {ride.driver.last_name}
          </Text>
        </Row>
        <Row label="Fare">
          <Text className="text-base font-JakartaBold">
            {formatEur(ride.fare_price)}
          </Text>
        </Row>
        <View className="flex flex-row items-center w-full justify-between">
          <Text className="text-base font-JakartaMedium text-gray-500">
            Payment Status
          </Text>
          <Text
            testID="ride-card-payment"
            className={`text-base font-JakartaBold ${refunded ? "text-general-200" : "text-general-400"}`}
          >
            {refunded ? "Refunded" : "Paid"}
          </Text>
        </View>
      </View>

      {status.canTrack && (
        <CustomButton
          testID="ride-card-track"
          title="Track"
          accessibilityLabel={`Track ride to ${destination}`}
          className="mt-4"
          onPress={() => onOpen?.(ride)}
        />
      )}
      {status.badge === "upcoming" && (
        <CustomButton
          testID="ride-card-view"
          title="View ride"
          accessibilityLabel={`View ride to ${destination}`}
          bgVariant="outline"
          textVariant="primary"
          className="mt-4 shadow-none"
          onPress={() => onOpen?.(ride)}
        />
      )}
    </View>
  );
};

export default RideCard;
