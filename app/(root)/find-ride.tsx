import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import GoogleTextInput from "@/components/GoogleTextInput";
import RideLayout from "@/components/RideLayout";
import ScheduleModal from "@/components/ScheduleModal";
import { icons } from "@/constants";
import { checkSlot, describePickup } from "@/lib/schedule";
import { serverNow } from "@/services/clock";
import { useBookingStore, useLocationStore } from "@/store";

// A prop takes a colour string, not a class: read the token itself.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require("../../tailwind.config").theme.extend;

const FindRide = () => {
  const {
    userAddress,
    destinationAddress,
    setDestinationLocation,
    setUserLocation,
  } = useLocationStore();
  const { scheduledAt, setScheduledAt, slotNotice, clearSlotNotice } =
    useBookingStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** One per opening: a picker reopened while still open starts afresh too (K10). */
  const [pickerSession, setPickerSession] = useState(0);
  /** Why the picker opened by itself (K5, K6): shown inside it. */
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  /** K4: the time moved; shown under the When row until the rider goes on. */
  const [notice, setNotice] = useState<string | null>(null);

  const openPicker = useCallback((why: string | null) => {
    setNotice(null);
    setPickerNotice(why);
    setPickerSession((n) => n + 1);
    setPickerOpen(true);
  }, []);

  // K6: a quote or a booking found the slot gone, and the confirm list or Book
  // Ride came back here. Pick a new time, with the reason in the picker.
  useFocusEffect(
    useCallback(() => {
      if (slotNotice === null) return;
      openPicker(slotNotice);
      clearSlotNotice();
    }, [slotNotice, clearSlotNotice, openPicker]),
  );

  /**
   * K4/K5, on the server clock: a slot may have gone stale while the rider was
   * deciding. True when `atMs` can be used as it is; otherwise it was moved
   * (K4: stay, and show the new time) or dropped (K5: pick again).
   */
  const stillBookable = (atMs: number | null) => {
    const slot = checkSlot(atMs, serverNow());
    if (slot.status === "moved") {
      setScheduledAt(slot.atMs);
      setNotice(slot.notice);
      return false;
    }
    if (slot.status === "expired") {
      setScheduledAt(null);
      openPicker(slot.notice);
      return false;
    }
    return true;
  };

  const findNow = () => {
    if (!userAddress || !destinationAddress) {
      Alert.alert("Where to?", "Choose both a pickup and a destination.");
      return;
    }
    if (!stillBookable(scheduledAt)) return; // the next tap goes on
    setNotice(null);
    router.push("/(root)/confirm-ride");
  };

  return (
    <RideLayout title="Ride">
      <View className="my-3">
        <Text className="text-lg font-JakartaSemiBold mb-3">From</Text>
        <GoogleTextInput
          icon={icons.target}
          initialLocation={userAddress ?? undefined}
          containerStyle="bg-neutral-100"
          textInputBackgroundColor={colors.secondary["100"]}
          handlePress={setUserLocation}
        />
      </View>

      <View className="my-3">
        <Text className="text-lg font-JakartaSemiBold mb-3">To</Text>
        <GoogleTextInput
          icon={icons.map}
          initialLocation={destinationAddress ?? undefined}
          containerStyle="bg-neutral-100"
          textInputBackgroundColor="transparent"
          handlePress={setDestinationLocation}
        />
      </View>

      <View className="my-3">
        <Text className="text-lg font-JakartaSemiBold mb-3">When</Text>
        <TouchableOpacity
          testID="when-field"
          onPress={() => openPicker(null)}
          accessibilityRole="button"
          accessibilityLabel={`Pickup time: ${describePickup(scheduledAt, serverNow())}. Change`}
          className="flex flex-row items-center bg-neutral-100 rounded-xl px-5 py-4"
        >
          <Ionicons name="time-outline" size={22} color="black" />
          <Text className="text-base font-JakartaSemiBold ml-4 flex-1">
            {describePickup(scheduledAt, serverNow())}
          </Text>
          <Text className="text-base font-JakartaSemiBold text-primary-500">
            Change
          </Text>
        </TouchableOpacity>
        {notice && (
          <Text
            testID="schedule-notice"
            accessibilityLiveRegion="polite"
            className="text-sm font-JakartaSemiBold text-warning-700 mt-2"
          >
            {notice}
          </Text>
        )}
      </View>

      <CustomButton
        title={scheduledAt === null ? "Find Now" : "Find drivers"}
        onPress={findNow}
        className="mt-5"
      />

      <ScheduleModal
        key={pickerSession}
        visible={pickerOpen}
        nowMs={serverNow()}
        value={scheduledAt}
        notice={pickerNotice}
        onClose={() => setPickerOpen(false)}
        onConfirm={(atMs) => {
          setPickerOpen(false);
          // The grid is the one from the opening (K10): a picker left open a
          // while can offer a slot that is no longer bookable.
          if (!stillBookable(atMs)) return;
          setScheduledAt(atMs);
          setNotice(null);
        }}
      />
    </RideLayout>
  );
};

export default FindRide;
