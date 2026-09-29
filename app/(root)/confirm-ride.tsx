import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import DriverCard from "@/components/DriverCard";
import QuoteSummary from "@/components/QuoteSummary";
import RideLayout from "@/components/RideLayout";
import { useBookingStore, useDriverStore } from "@/store";
import { LoadStatus } from "@/types/type";

/** In place of the driver cards: the load failed (Q5), none exist (Q6), or they are loading. */
const NoDrivers = ({
  status,
  error,
  onRetry,
}: {
  status: LoadStatus;
  error: string | null;
  onRetry: () => void;
}) => {
  if (status === "error") {
    return (
      <View testID="drivers-error" className="mt-2">
        <Text className="text-base font-JakartaSemiBold">
          Couldn't load drivers
        </Text>
        {error && (
          <Text className="text-sm font-Jakarta text-general-200">{error}</Text>
        )}
        <CustomButton
          testID="drivers-retry"
          title="Retry"
          bgVariant="outline"
          textVariant="primary"
          className="mt-3 shadow-none w-1/2"
          onPress={onRetry}
        />
      </View>
    );
  }
  if (status === "ready") {
    return (
      <Text testID="drivers-empty" className="text-base font-JakartaSemiBold">
        No drivers are available right now
      </Text>
    );
  }
  return (
    <View testID="drivers-loading" className="flex flex-row items-center mt-2">
      <ActivityIndicator size="small" color="black" />
      <Text className="text-base font-Jakarta text-general-200 ml-2">
        Finding drivers…
      </Text>
    </View>
  );
};

const ConfirmRide = () => {
  const {
    drivers,
    driversStatus,
    driversError,
    reloadDrivers,
    selectedDriver,
    setSelectedDriver,
    quote,
    quoteStatus,
    quoteError,
    requestQuote,
  } = useDriverStore();
  const scheduledAt = useBookingStore((s) => s.scheduledAt);
  const slotNotice = useBookingStore((s) => s.slotNotice);
  const priced = quoteStatus === "ready" && quote !== null;

  // K6: the server refused the pickup time — back to Find ride, whose picker
  // opens with the notice (Retry here would only ask for the same slot again).
  useFocusEffect(
    useCallback(() => {
      if (slotNotice !== null) router.navigate("/(root)/find-ride");
    }, [slotNotice]),
  );

  // Q5: the drivers failed to load (offline at sign-in, say) — try again each
  // time the rider comes here, not only on Retry. Read on focus, so a failed
  // reload does not start another one by itself.
  useFocusEffect(
    useCallback(() => {
      if (useDriverStore.getState().driversStatus === "error") reloadDrivers();
    }, [reloadDrivers]),
  );

  return (
    <RideLayout
      title="Choose a Driver"
      snapPoints={["65%", "85%"]}
      scrollable={false}
    >
      <FlatList
        data={drivers}
        keyExtractor={(driver) => String(driver.id)}
        ListHeaderComponent={
          <QuoteSummary
            status={quoteStatus}
            error={quoteError}
            surgeMultiplier={quote?.surgeMultiplier ?? null}
            scheduledAt={scheduledAt}
            onRetry={requestQuote}
          />
        }
        ListEmptyComponent={
          <NoDrivers
            status={driversStatus}
            error={driversError}
            onRetry={reloadDrivers}
          />
        }
        renderItem={({ item }) => (
          <DriverCard
            item={item}
            selected={selectedDriver}
            setSelected={() => setSelectedDriver(item.id)}
            fareCents={priced ? quote.fareCents : null}
            hidePickupTime={scheduledAt !== null}
          />
        )}
        ListFooterComponent={
          <View className="mx-5 mt-10 mb-10">
            <CustomButton
              testID="select-ride"
              title="Select Ride"
              // R13: nothing to book until a priced driver is chosen.
              disabled={!priced || selectedDriver === null}
              onPress={() => router.push("/(root)/book-ride")}
            />
          </View>
        }
      />
    </RideLayout>
  );
};

export default ConfirmRide;
