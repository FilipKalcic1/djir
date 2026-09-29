import { Text, View } from "react-native";

import ActiveRideBanner from "@/components/ActiveRideBanner";
import RideCard from "@/components/RideCard";
import { rideStatus, sortRidesForHistory } from "@/lib/rides";

import { cancelled, live, NOW, upcoming } from "../fixtures";
import { Shot } from "../Shot";

const rides = sortRidesForHistory([cancelled, upcoming, live], NOW);

/**
 * Not a whole screen: Home's live-ride banner above the ride cards that Home
 * and the Rides tab list (Home's search box and map sit between them in the app).
 */
export default function History() {
  return (
    <Shot>
      <View className="px-5 pt-6">
        <ActiveRideBanner rides={rides} nowMs={NOW} onOpen={() => {}} />
        <Text className="text-xl font-JakartaBold mb-3">Recent Rides</Text>
        {rides.map((ride) => (
          <RideCard
            key={ride.ride_id}
            ride={ride}
            status={rideStatus(ride, NOW)}
            onOpen={() => {}}
          />
        ))}
      </View>
    </Shot>
  );
}
