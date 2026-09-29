/**
 * services/reminders.ts — local notifications for scheduled rides (N1–N9).
 *
 *  - Reminders are derived from ride history (N7): every history load makes
 *    the scheduled reminders match it, so a sign-in on a new device, a ride
 *    that appears only after reconcile, or a cancel elsewhere all converge.
 *  - Android 13+ shows the permission prompt only once a notification channel
 *    exists, so the channel is created first (N6).
 *  - The rider is asked in context, and only while the OS has never asked
 *    (N3). The OS's own one-prompt rule is the "once": an app flag would outlive
 *    a reinstall in the iOS Keychain and silence reminders for good.
 *  - Reminder times are on the server's clock; the OS fires them on the
 *    device's, so each one is handed over shifted by the clock offset (N8).
 *  - Each reminder carries its ride id, so a tap opens that ride — once: the
 *    tap is then cleared from the OS (N5).
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { Reminder, reminderId } from "@/lib/reminders";
import { serverClockOffsetMs } from "@/services/clock";

export const REMINDER_CHANNEL = "ride-reminders";

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: "Ride reminders",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/**
 * Whether reminders may be shown. Prompts only if `ask` and the OS has never
 * asked (status "undetermined"): never after a denial, and again after a
 * reinstall, when the OS forgets the answer (N3).
 */
export async function reminderPermission({
  ask,
}: {
  ask: boolean;
}): Promise<boolean> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!ask || current.status !== "undetermined") return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Hand one reminder to the OS, on the device clock (N8). One already due on
 * this device is skipped: iOS refuses a trigger in the past (N9).
 *
 * The trigger names its type (N1): expo-notifications 57 reads a trigger
 * object as a date only with `type: DATE`. Without it, `parseTrigger` takes
 * `{ date, channelId }` for a channel-only trigger, which is delivered at once
 * (a channel trigger on Android, `null` — "now" — on iOS).
 */
async function schedule(reminder: Reminder): Promise<void> {
  const deviceAtMs = reminder.atMs - serverClockOffsetMs();
  if (deviceAtMs <= Date.now()) return;
  await Notifications.scheduleNotificationAsync({
    identifier: reminder.id,
    content: {
      title: reminder.title,
      body: reminder.body,
      data: { rideId: reminder.rideId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: deviceAtMs,
      channelId: REMINDER_CHANNEL,
    },
  });
}

/** Right after a ride is scheduled: ask (N3) and schedule its reminder (N1). */
export async function remindAbout(reminder: Reminder | null): Promise<void> {
  if (!reminder || !(await reminderPermission({ ask: true }))) return;
  await schedule(reminder);
}

/**
 * Make the scheduled reminders match `wanted` (N7): cancel `ride-*` ones that
 * are no longer wanted, schedule the missing ones. Never prompts. One reminder
 * the OS refuses is logged and the rest still go through (N9).
 */
export async function syncReminders(wanted: Reminder[]): Promise<void> {
  if (!(await reminderPermission({ ask: false }))) return;
  const wantedIds = new Set(wanted.map((r) => r.id));
  const existing = new Set(
    (await Notifications.getAllScheduledNotificationsAsync()).map(
      (n) => n.identifier,
    ),
  );
  for (const id of existing) {
    if (id.startsWith("ride-") && !wantedIds.has(id)) {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  }
  for (const reminder of wanted) {
    if (existing.has(reminder.id)) continue;
    try {
      await schedule(reminder);
    } catch (err) {
      console.warn(`Could not schedule reminder ${reminder.id}:`, err);
    }
  }
}

/** When a ride is cancelled (N4): its reminder goes too. */
export async function cancelReminder(rideId: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(reminderId(rideId));
}

/** On sign-out (N4): the next user must not get this user's reminders. */
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** The ride a tapped reminder points at, if any (N5). */
export function rideIdFromResponse(
  response: Notifications.NotificationResponse | null | undefined,
): number | null {
  const rideId = response?.notification.request.content.data?.rideId;
  return typeof rideId === "number" ? rideId : null;
}

/**
 * The ride a tapped reminder should open — once (N5). The OS keeps the last
 * response, through a JS reload too, and expo-notifications hands it to every
 * new mount of its hook (after a sign-out and sign-in), so a tap acted on is
 * cleared from the OS. `handled` holds the taps (identifier and delivery
 * time) the caller already acted on: the SDK may hand one tap over twice, as
 * the launch response and again through its listener.
 */
export function rideToOpen(
  response: Notifications.NotificationResponse | null | undefined,
  handled: Set<string>,
): number | null {
  const rideId = rideIdFromResponse(response);
  if (rideId === null) return null;
  const { request, date } = response!.notification;
  const tap = `${request.identifier}@${date}`;
  if (handled.has(tap)) return null;
  handled.add(tap);
  Notifications.clearLastNotificationResponseAsync().catch((err: unknown) =>
    console.warn("Could not clear the reminder tap:", err),
  );
  return rideId;
}
