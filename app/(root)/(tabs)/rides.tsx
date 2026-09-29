import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import RideList from "@/components/RideList";
import { SPEEDUP, useRides } from "@/hooks/useRides";

/** All rides: Live first, then Upcoming (soonest first), then past rides. */
const Rides = () => {
  const { rides, loading, error, refetch, nowMs } = useRides();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <RideList
        rides={rides}
        loading={loading}
        error={error}
        nowMs={nowMs}
        speedup={SPEEDUP}
        onRefresh={refetch}
        header={
          <Text className="text-2xl font-JakartaBold my-5">All Rides</Text>
        }
      />
    </SafeAreaView>
  );
};

export default Rides;
