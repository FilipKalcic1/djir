import { useAuth, useUser } from "@clerk/clerk-expo";
import { router } from "expo-router";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActiveRideBanner from "@/components/ActiveRideBanner";
import GoogleTextInput from "@/components/GoogleTextInput";
import Map from "@/components/Map";
import RideList, { openRide } from "@/components/RideList";
import { icons } from "@/constants";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { SPEEDUP, useRides } from "@/hooks/useRides";
import { displayName } from "@/lib/utils";
import { cancelAllReminders } from "@/services/reminders";
import { resetSession, useBookingStore, useLocationStore } from "@/store";

const LOCATION_NOTICE = {
  denied: "Location is off — type your pickup address when you book.",
  unavailable:
    "We couldn't find your location — type your pickup address when you book.",
} as const;

const Home = () => {
  const { user } = useUser();
  const { signOut } = useAuth();
  const setDestinationLocation = useLocationStore(
    (s) => s.setDestinationLocation,
  );
  const setScheduledAt = useBookingStore((s) => s.setScheduledAt);
  const locationStatus = useCurrentLocation();
  const { rides, loading, error, refetch, nowMs } = useRides();

  const handleSignOut = async () => {
    await signOut();
    resetSession(); // the next user must not see this user's trip (R52)
    await cancelAllReminders().catch(() => {});
    router.replace("/(auth)/sign-in");
  };

  const handleDestinationPress = (place: {
    latitude: number;
    longitude: number;
    address: string;
  }) => {
    setScheduledAt(null); // every trip from Home starts as "Now"
    setDestinationLocation(place);
    router.push("/(root)/find-ride");
  };

  return (
    <SafeAreaView className="bg-general-500 flex-1">
      <RideList
        rides={rides.slice(0, 5)}
        loading={loading}
        error={error}
        nowMs={nowMs}
        speedup={SPEEDUP}
        onRefresh={refetch}
        header={
          <>
            <View className="flex flex-row items-center justify-between my-5">
              <Text className="text-2xl font-JakartaExtraBold">
                Welcome {displayName(user)} 👋
              </Text>
              <TouchableOpacity
                onPress={handleSignOut}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                className="justify-center items-center w-10 h-10 rounded-full bg-white"
              >
                <Image source={icons.out} className="w-4 h-4" />
              </TouchableOpacity>
            </View>

            <ActiveRideBanner
              rides={rides}
              nowMs={nowMs}
              speedup={SPEEDUP}
              onOpen={openRide}
            />

            <GoogleTextInput
              icon={icons.search}
              containerStyle="bg-white shadow-md shadow-neutral-300"
              handlePress={handleDestinationPress}
            />

            <Text className="text-xl font-JakartaBold mt-5 mb-3">
              Your current location
            </Text>
            {(locationStatus === "denied" ||
              locationStatus === "unavailable") && (
              <Text
                testID="location-notice"
                className="text-sm font-Jakarta text-general-200 mb-2"
              >
                {LOCATION_NOTICE[locationStatus]}
              </Text>
            )}
            <View className="flex flex-row items-center bg-transparent h-[300px]">
              <Map />
            </View>

            <Text className="text-xl font-JakartaBold mt-5 mb-3">
              Recent Rides
            </Text>
          </>
        }
      />
    </SafeAreaView>
  );
};

export default Home;
