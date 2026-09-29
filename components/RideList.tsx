import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  Text,
  View,
} from "react-native";

import CustomButton from "@/components/CustomButton";
import RideCard from "@/components/RideCard";
import { images } from "@/constants";
import { rideStatus, trackRideHref } from "@/lib/rides";
import { Ride } from "@/types/type";

/** Opens a ride's tracker: a card's Track / View ride, or the Home banner. */
export const openRide = (ride: Ride) =>
  router.push(trackRideHref(ride.ride_id));

interface RideListProps {
  rides: Ride[];
  loading: boolean;
  error: string | null;
  nowMs: number;
  speedup: number;
  onRefresh: () => void;
  header: React.ReactElement;
}

/** Ride history with its loading, empty, error and refresh states (H8–H10, R47). */
const RideList = ({
  rides,
  loading,
  error,
  nowMs,
  speedup,
  onRefresh,
  header,
}: RideListProps) => (
  <FlatList
    testID="rides-list"
    data={rides}
    keyExtractor={(ride) => String(ride.ride_id)}
    renderItem={({ item }) => (
      <RideCard
        ride={item}
        status={rideStatus(item, nowMs, speedup)}
        onOpen={openRide}
      />
    )}
    className="px-5"
    keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ paddingBottom: 120 }}
    refreshControl={
      <RefreshControl
        refreshing={loading && rides.length > 0}
        onRefresh={onRefresh}
      />
    }
    ListHeaderComponent={header}
    ListEmptyComponent={
      <View className="flex flex-col items-center justify-center py-6">
        {loading ? (
          <ActivityIndicator
            testID="rides-loading"
            size="small"
            color="black"
            accessibilityLabel="Loading your rides"
          />
        ) : error ? (
          <View testID="rides-error" className="items-center w-full">
            <Text className="text-base font-JakartaSemiBold">
              Couldn't load your rides
            </Text>
            <Text className="text-sm font-Jakarta text-general-200 mt-1 text-center">
              {error}
            </Text>
            <CustomButton
              testID="rides-retry"
              title="Retry"
              bgVariant="outline"
              textVariant="primary"
              className="mt-4 shadow-none w-1/2"
              onPress={onRefresh}
            />
          </View>
        ) : (
          <View testID="rides-empty" className="items-center">
            <Image
              source={images.noResult}
              className="w-40 h-40"
              accessibilityLabel="No rides yet"
              resizeMode="contain"
            />
            <Text className="text-sm font-Jakarta">No rides yet</Text>
          </View>
        )}
      </View>
    }
  />
);

export default RideList;
