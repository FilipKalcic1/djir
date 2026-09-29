import { useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import AppModal from "@/components/AppModal";
import CustomButton from "@/components/CustomButton";
import { ScheduleDay, scheduleDays, Slot } from "@/lib/schedule";
import { zagrebZoneName } from "@/lib/zagreb-time";

interface ScheduleModalProps {
  visible: boolean;
  /** The server clock; read once, when the picker opens. */
  nowMs: number;
  /** The current choice: epoch ms, or null for "Now". */
  value: number | null;
  /** Why the picker opened by itself (K5, K6), shown at its top. */
  notice?: string | null;
  onConfirm: (scheduledAt: number | null) => void;
  onClose: () => void;
}

/** The ✕ glyph is about 24 pt; this brings its touch target past 44 pt. */
const CLOSE_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

const Chip = ({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    testID={testID}
    onPress={onPress}
    accessibilityRole="radio"
    accessibilityState={{ checked: selected }}
    className={`rounded-full px-3 py-2 mr-2 mb-2 ${selected ? "bg-primary-500" : "bg-general-500"}`}
  >
    <Text
      className={`text-sm font-JakartaSemiBold ${selected ? "text-white" : "text-black"}`}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

/** Group a day's slots into hour rows ("08" → 08:00 08:15 08:30 08:45). */
function hourRows(slots: Slot[]) {
  const rows: { hour: string; slots: Slot[] }[] = [];
  for (const slot of slots) {
    const hour = `${slot.label.slice(0, 2)}${slot.label.length > 5 ? slot.label.slice(5) : ""}`;
    if (rows.length === 0 || rows[rows.length - 1].hour !== hour) {
      rows.push({ hour, slots: [] });
    }
    rows[rows.length - 1].slots.push(slot);
  }
  return rows;
}

/**
 * Where a picker session starts: `value` while it is still on offer, or else
 * the earliest slot (a time that has gone stale is never preselected). Now
 * only when it was chosen — not when the picker opened because the rider's
 * time was refused (a notice, K5/K6): they were scheduling, and one tap on
 * the big button must not turn that into a ride now.
 */
function startOf(
  days: ScheduleDay[],
  value: number | null,
  notice: string | null,
) {
  if (value === null && notice === null) return { choice: null, dayKey: null };
  const day = days.find((d) => d.slots.some((s) => s.atMs === value));
  if (day) return { choice: value, dayKey: day.key };
  return { choice: days[0].slots[0].atMs, dayKey: days[0].key };
}

/**
 * Pick a pickup time: Now, or a 15-minute slot up to 7 days ahead, on the
 * Zagreb clock (ADR-012). Only valid slots are offered.
 */
const ScheduleModal = ({
  visible,
  nowMs,
  value,
  notice = null,
  onConfirm,
  onClose,
}: ScheduleModalProps) => {
  // K10: one session per opening. The grid and the starting choice are taken
  // on the closed → open edge only, so a parent re-rendering while the picker
  // is open (a new nowMs, a new value) never resets what the rider chose.
  const [wasVisible, setWasVisible] = useState(false);
  const [openedAtMs, setOpenedAtMs] = useState(nowMs);
  const [days, setDays] = useState<ScheduleDay[]>([]);
  const [choice, setChoice] = useState<number | null>(value);
  const [dayKey, setDayKey] = useState<string | null>(null);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      const offered = scheduleDays(nowMs);
      const start = startOf(offered, value, notice);
      setOpenedAtMs(nowMs);
      setDays(offered);
      setChoice(start.choice);
      setDayKey(start.dayKey);
    }
  }

  const day = days.find((d) => d.key === dayKey) ?? days[0];

  return (
    <AppModal
      visible={visible}
      onBackdropPress={onClose}
      onRequestClose={onClose}
    >
      <View
        testID="schedule-modal"
        className="bg-white px-7 py-9 rounded-2xl max-h-[85%]"
      >
        <View className="flex flex-row items-center justify-between mb-4">
          <Text
            accessibilityRole="header"
            className="text-2xl font-JakartaExtraBold"
          >
            Schedule a ride
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={CLOSE_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text className="text-2xl font-JakartaBold text-general-200">
              ✕
            </Text>
          </TouchableOpacity>
        </View>

        {notice && (
          <Text
            testID="schedule-modal-notice"
            accessibilityLiveRegion="polite"
            className="text-sm font-JakartaSemiBold text-warning-700 mb-3"
          >
            {notice}
          </Text>
        )}

        <View className="flex flex-row flex-wrap">
          <Chip
            testID="schedule-chip-now"
            label="Now"
            selected={choice === null}
            onPress={() => setChoice(null)}
          />
          {days.map((d) => (
            <Chip
              key={d.key}
              testID={`schedule-day-${d.key}`}
              label={d.label}
              selected={choice !== null && d.key === day?.key}
              onPress={() => {
                setDayKey(d.key);
                if (!d.slots.some((s) => s.atMs === choice))
                  setChoice(d.slots[0].atMs);
              }}
            />
          ))}
        </View>

        {choice !== null && day && (
          <ScrollView className="mt-2 max-h-72" testID="schedule-slots">
            {hourRows(day.slots).map((row) => (
              <View
                key={`${day.key}-${row.hour}`}
                className="flex flex-row flex-wrap"
              >
                {row.slots.map((slot) => (
                  <Chip
                    key={slot.atMs}
                    testID={`schedule-slot-${new Date(slot.atMs).toISOString()}`}
                    label={slot.label}
                    selected={slot.atMs === choice}
                    onPress={() => setChoice(slot.atMs)}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        )}

        <Text className="text-xs font-Jakarta text-general-200 mt-3">
          Times in Zagreb ({zagrebZoneName(choice ?? openedAtMs)})
        </Text>
        <CustomButton
          testID="schedule-confirm"
          title={choice === null ? "Ride now" : "Set pickup time"}
          className="mt-5"
          onPress={() => onConfirm(choice)}
        />
      </View>
    </AppModal>
  );
};

export default ScheduleModal;
