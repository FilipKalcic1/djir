import { Text, TouchableOpacity, View } from "react-native";

import { describePickup } from "@/lib/schedule";
import {
  countdownMinutes,
  isArrivingNow,
  phaseAt,
  timelineFor,
} from "@/lib/tracking";
import { placeName } from "@/lib/utils";
import { Ride } from "@/types/type";

interface ActiveRideBannerProps {
  /** The rider's history, in any order (the first live ride in it wins a tie). */
  rides: Ride[];
  nowMs: number;
  speedup?: number;
  onOpen: (ride: Ride) => void;
}

/**
 * The way back into a ride from Home: pinned above the fold whenever a ride is
 * live or coming up (states B1/B2). A live ride beats any upcoming one, and the
 * soonest upcoming ride beats the rest (B4). Renders nothing otherwise.
 */
const ActiveRideBanner = ({
  rides,
  nowMs,
  speedup = 1,
  onOpen,
}: ActiveRideBannerProps) => {
  let upcoming: { ride: Ride; pickupMs: number } | null = null;
  for (const ride of rides) {
    const timeline = timelineFor(ride);
    if (!timeline) continue;
    const state = phaseAt(timeline, nowMs, speedup);
    const { phase } = state;

    if (phase === "en_route" || phase === "arrived" || phase === "on_trip") {
      const name = ride.driver.first_name;
      // The tracker's countdown: rounded up, and "now" in the pickup leg's
      // last minute.
      const minutes = countdownMinutes(state.minutesLeft);
      const text =
        phase === "en_route"
          ? isArrivingNow(state)
            ? `${name} is arriving now` // B1d
            : `${name} is arriving in ${minutes} min` // B1a
          : phase === "arrived"
            ? `${name} has arrived` // B1b
            : `${minutes} min to ${placeName(ride.destination_address)}`; // B1c
      return (
        <Banner
          testID="active-ride-live"
          label="Live"
          text={text}
          action="Track"
          onPress={() => onOpen(ride)}
        />
      );
    }
    if (phase === "scheduled") {
      const pickupMs = timeline.departAtMs + timeline.pickupMinutes * 60_000;
      if (!upcoming || pickupMs < upcoming.pickupMs) {
        upcoming = { ride, pickupMs };
      }
    }
  }
  if (!upcoming) return null;
  const { ride, pickupMs } = upcoming;
  return (
    <Banner
      testID="active-ride-upcoming"
      label="Upcoming"
      text={describePickup(pickupMs, nowMs)}
      action="View"
      onPress={() => onOpen(ride)}
    />
  );
};

const Banner = ({
  testID,
  label,
  text,
  action,
  onPress,
}: {
  testID: string;
  label: string;
  text: string;
  action: string;
  onPress: () => void;
}) => (
  <TouchableOpacity
    testID={testID}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${label} ride: ${text}. ${action}`}
    className="flex flex-row items-center justify-between bg-primary-500 rounded-2xl px-4 py-3 mb-4"
  >
    <View className="flex-1 mr-3">
      <Text className="text-xs font-JakartaBold text-primary-200 uppercase">
        {label}
      </Text>
      <Text
        className="text-base font-JakartaSemiBold text-white"
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
    <Text className="text-base font-JakartaBold text-white">{action} ›</Text>
  </TouchableOpacity>
);

export default ActiveRideBanner;
