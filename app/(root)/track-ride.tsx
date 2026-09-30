import { useAuth } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, View } from "react-native";

import RideLayout from "@/components/RideLayout";
import TrackingMap from "@/components/TrackingMap";
import TrackingSheet, { TrackingSheetState } from "@/components/TrackingSheet";
import { SPEEDUP, useRides } from "@/hooks/useRides";
import { useRideTracking } from "@/hooks/useRideTracking";
import { pastRide, simulatedPosition, trackedRideFrom } from "@/lib/tracking";
import { formatEur } from "@/lib/utils";
import { ApiError } from "@/services/api";
import { cancelRide } from "@/services/booking";
import { cancelReminder } from "@/services/reminders";
import { Ride } from "@/types/type";

const source = simulatedPosition(SPEEDUP);
/**
 * Back to the Home tab: pops to the tabs if they are below (every in-app entry
 * point), or replaces the tracker with them (a cold-start deep link or reminder
 * tap). navigate would push a second copy of the tabs on top (expo-router 4+).
 */
const goHome = () => router.dismissTo("/(root)/(tabs)/home");
/** Where the sheet rests, in % of the screen: the map frames the ride above it (MP7). */
const SHEET_REST_PERCENT = 45;

/** What a failed cancel tells the rider: [title, message] (WP3 Cancel table). */
function cancelFailure(err: unknown): [string, string] {
  if (err instanceof ApiError && err.status === 409) {
    return ["Couldn't cancel", err.message]; // the server's reason
  }
  if (err instanceof ApiError && err.status === 502) {
    return [
      "Couldn't cancel",
      "We couldn't process the refund. Your ride is still booked — try again.",
    ];
  }
  // A lost connection, a timeout or an unexpected error: the refund may have
  // gone through, so promise nothing and let the refetch show the ride (X9).
  return [
    "Cancellation not confirmed",
    "We couldn't confirm the cancellation. Checking your ride…",
  ];
}

/**
 * Live tracking (Figma 14). The ride comes from the rider's own history, so a
 * foreign or unknown id is simply "not found" (T9); its phase and the car's position
 * are recomputed from the ride and a server-corrected clock every tick, so
 * reopening the app resumes exactly where the ride is (ADR-009).
 */
const TrackRide = () => {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { getToken } = useAuth();
  const { rides, loading, error, refetch, clockOffsetMs } = useRides({
    tickMs: 30_000,
  });
  const [cancelling, setCancelling] = useState(false);
  // The ride the cancel route returned: S9 at once, not after the refetch (X10).
  const [cancelled, setCancelled] = useState<Ride | null>(null);

  const fromCancel = cancelled !== null && String(cancelled.ride_id) === rideId;
  const ride = fromCancel
    ? cancelled
    : (rides.find((r) => String(r.ride_id) === rideId) ?? null);
  const tracked = useMemo(() => (ride ? trackedRideFrom(ride) : null), [ride]);
  const snapshot = useRideTracking(tracked, {
    source,
    now: () => Date.now() + clockOffsetMs,
    tickMs: SPEEDUP > 1 ? 250 : 1000,
  });

  const state: TrackingSheetState =
    tracked && snapshot
      ? {
          kind: "ride",
          ride: tracked.ride,
          timeline: tracked.timeline,
          phase: snapshot,
          nowMs: Date.now() + clockOffsetMs,
        }
      : ride // in history, but booked before live tracking (T7): it is over
        ? { kind: "ride", ride, ...pastRide(ride), nowMs: Date.now() }
        : loading && rides.length === 0
          ? { kind: "loading" }
          : error && rides.length === 0
            ? { kind: "error", message: error }
            : { kind: "not_found" };

  const confirmCancel = () => {
    if (!tracked) return;
    const { ride_id, fare_price } = tracked.ride;
    Alert.alert(
      "Cancel this ride?",
      `You'll be refunded ${formatEur(fare_price)} to your card.`,
      [
        { text: "Keep ride", style: "cancel" },
        {
          text: "Cancel ride",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              setCancelled(await cancelRide(ride_id, getToken));
              await cancelReminder(ride_id).catch(() => {});
            } catch (err) {
              Alert.alert(...cancelFailure(err));
            } finally {
              // Cancel stays disabled until the history shows where the ride
              // stands, so a rider never cancels twice blind.
              await refetch();
              setCancelling(false);
            }
          },
        },
      ],
    );
  };

  return (
    <RideLayout
      title="Your Ride"
      snapPoints={[`${SHEET_REST_PERCENT}%`, "85%"]}
      onBack={() => (router.canGoBack() ? router.back() : goHome())}
      map={
        tracked && snapshot ? (
          <TrackingMap
            ride={tracked}
            snapshot={snapshot}
            coveredBottom={SHEET_REST_PERCENT / 100}
          />
        ) : (
          <View className="flex-1 bg-general-600" />
        )
      }
    >
      <TrackingSheet
        state={state}
        onBackHome={goHome}
        onRetry={refetch}
        onCancel={confirmCancel}
        cancelling={cancelling}
        // X14: the history could not be checked again (X9's check while still
        // offline, say): the ride as last loaded, with why and Retry. A ride
        // the cancel route returned (X10) is already where it stands.
        refreshError={ride && !fromCancel ? error : null}
      />
    </RideLayout>
  );
};

export default TrackRide;
