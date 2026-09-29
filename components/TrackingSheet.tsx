import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Text,
  View,
} from "react-native";

import CustomButton from "@/components/CustomButton";
import RouteSummary from "@/components/RouteSummary";
import {
  Headline,
  PhaseState,
  RideTimeline,
  trackingDetail,
  trackingHeadline,
} from "@/lib/tracking";
import { Ride } from "@/types/type";

export type TrackingSheetState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "not_found" }
  | {
      kind: "ride";
      ride: Ride;
      timeline: RideTimeline;
      phase: PhaseState;
      nowMs: number;
    };

interface TrackingSheetProps {
  state: TrackingSheetState;
  onBackHome: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  /**
   * The ride shown is the one last loaded, because checking it again failed
   * (e.g. X9's check while still offline): why, with Retry (X14).
   */
  refreshError?: string | null;
}

/**
 * Reads a phase change out once, as the new headline ("Your driver has
 * arrived", "12 Mins to destination"), with VoiceOver and TalkBack alike. A
 * live region on the headline would also interrupt at every minute of the
 * countdown; opening the tracker announces nothing (its header can be focused).
 */
function useAnnouncePhase(phase: string | null, headline: Headline | null) {
  const announced = useRef(phase);
  useEffect(() => {
    if (phase === announced.current) return;
    if (announced.current !== null && phase !== null && headline) {
      AccessibilityInfo.announceForAccessibility(
        `${headline.lead}${headline.accent}${headline.tail}`,
      );
    }
    announced.current = phase;
  }, [phase, headline]);
}

/** The live-tracking bottom sheet (Figma 14; states S1–S9 of the build plan). */
const TrackingSheet = ({
  state,
  onBackHome,
  onRetry,
  onCancel,
  cancelling = false,
  refreshError = null,
}: TrackingSheetProps) => {
  const headline =
    state.kind === "ride"
      ? trackingHeadline(state.phase, state.timeline)
      : null;
  useAnnouncePhase(state.kind === "ride" ? state.phase.phase : null, headline);

  const backHome = (
    <CustomButton
      testID="tracking-back-home"
      title="Back Home"
      className="mt-6"
      onPress={onBackHome}
    />
  );

  if (state.kind === "loading") {
    return (
      <View testID="tracking-loading" className="items-center py-10">
        <ActivityIndicator size="small" color="black" />
        <Text className="text-base font-Jakarta text-general-200 mt-3">
          Loading your ride…
        </Text>
      </View>
    );
  }

  if (state.kind === "error" || state.kind === "not_found") {
    const isError = state.kind === "error";
    return (
      <View testID={isError ? "tracking-error" : "tracking-not-found"}>
        <Text
          accessibilityRole="header"
          className="text-xl font-JakartaSemiBold"
        >
          {isError ? "Couldn't load your ride" : "Ride not found"}
        </Text>
        {isError && (
          <Text className="text-base font-Jakarta text-general-200 mt-2">
            {state.message}
          </Text>
        )}
        {isError && onRetry && (
          <CustomButton
            testID="tracking-retry"
            title="Retry"
            bgVariant="outline"
            textVariant="primary"
            className="mt-6 shadow-none"
            onPress={onRetry}
          />
        )}
        {backHome}
      </View>
    );
  }

  const { ride, timeline, phase, nowMs } = state;
  const { lead, accent, tail } = headline!;
  const detail = trackingDetail(phase, ride, timeline, nowMs);
  const driverName = `${ride.driver.first_name} ${ride.driver.last_name}`;

  return (
    <View testID={`tracking-${phase.phase}`}>
      <Text
        testID="tracking-headline"
        // Focusable as a header; a phase change is announced (useAnnouncePhase).
        accessibilityRole="header"
        className="text-xl font-JakartaSemiBold"
      >
        {lead}
        <Text
          className={
            phase.phase === "cancelled" ? "text-danger-600" : "text-general-400"
          }
        >
          {accent}
        </Text>
        {tail}
      </Text>
      {detail && (
        <Text
          testID="tracking-detail"
          className="text-base font-Jakarta text-general-200 mt-1"
        >
          {detail}
        </Text>
      )}
      {refreshError && (
        <View testID="tracking-refresh-error" className="mt-3">
          <Text className="text-base font-JakartaSemiBold text-danger-700">
            Couldn't check your ride
          </Text>
          <Text className="text-sm font-Jakarta text-general-200">
            {refreshError}
          </Text>
          {onRetry && (
            <CustomButton
              testID="tracking-refresh-retry"
              title="Retry"
              bgVariant="outline"
              textVariant="primary"
              className="mt-2 shadow-none w-1/2"
              onPress={onRetry}
            />
          )}
        </View>
      )}

      <View
        testID="tracking-driver-card"
        className="flex flex-row items-center justify-between bg-general-600 rounded-2xl p-4 mt-5"
      >
        <View className="items-center">
          <Image
            source={{ uri: ride.driver.profile_image_url ?? undefined }}
            className="w-16 h-16 rounded-full"
            accessibilityLabel={driverName}
          />
          <Text className="text-base font-JakartaSemiBold mt-2">
            {driverName}
          </Text>
        </View>
        <Image
          source={{ uri: ride.driver.car_image_url ?? undefined }}
          className="w-36 h-20"
          resizeMode="contain"
          accessibilityLabel="Car"
        />
      </View>
      {/* Djir has no driver app: the driver's moves are predicted, not reported. */}
      <Text
        testID="tracking-simulated"
        className="text-xs font-Jakarta text-general-200 mt-2"
      >
        Simulated driver · Djir has no driver app yet
      </Text>

      <RouteSummary
        origin={ride.origin_address}
        destination={ride.destination_address}
      />

      {phase.phase === "scheduled" && onCancel && (
        <CustomButton
          testID="ride-cancel"
          title="Cancel ride"
          bgVariant="outline"
          textVariant="primary"
          className="mt-6 shadow-none"
          loading={cancelling}
          onPress={onCancel}
        />
      )}
      {backHome}
    </View>
  );
};

export default TrackingSheet;
