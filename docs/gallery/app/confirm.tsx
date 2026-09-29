import { FlatList, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import DriverCard from "@/components/DriverCard";
import QuoteSummary from "@/components/QuoteSummary";
import RideLayout from "@/components/RideLayout";

import { bookedQuote, markers, PICKUP_AT } from "../fixtures";
import { Shot } from "../Shot";

/**
 * confirm-ride.tsx's sheet, pulled up to its second snap point (85%): the
 * seed drivers priced for today 09:00, Michael selected. (It rests at 65%,
 * where the fifth driver is cut off and Select Ride is below the fold.)
 */
export default function Confirm() {
  return (
    <Shot>
      <RideLayout
        title="Choose a Driver"
        snapPoints={["85%"]}
        scrollable={false}
        onBack={() => {}}
      >
        <FlatList
          data={markers}
          keyExtractor={(driver) => String(driver.id)}
          ListHeaderComponent={
            <QuoteSummary
              status="ready"
              error={null}
              surgeMultiplier={bookedQuote.surgeMultiplier}
              scheduledAt={PICKUP_AT}
              onRetry={() => {}}
            />
          }
          renderItem={({ item }) => (
            <DriverCard
              item={item}
              selected={3}
              setSelected={() => {}}
              fareCents={bookedQuote.fareCents}
              hidePickupTime
            />
          )}
          ListFooterComponent={
            <View className="mx-5 mt-10 mb-10">
              <CustomButton title="Select Ride" onPress={() => {}} />
            </View>
          }
        />
      </RideLayout>
    </Shot>
  );
}
