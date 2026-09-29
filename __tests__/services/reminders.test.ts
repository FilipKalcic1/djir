/**
 * services/reminders — local ride reminders (N1, N3–N9). expo-notifications is
 * an in-memory fake whose permission behaves like the OS's; the reminders
 * themselves come from the real lib/reminders, the clock offset from the real
 * services/clock, and the device clock is pinned with fake timers.
 */
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { Reminder, reminderFor } from "@/lib/reminders";
import { setServerTime } from "@/services/clock";
import {
  cancelAllReminders,
  cancelReminder,
  REMINDER_CHANNEL,
  reminderPermission,
  remindAbout,
  rideIdFromResponse,
  rideToOpen,
  syncReminders,
} from "@/services/reminders";

import {
  lastTap,
  permission,
  resetNotifications,
  scheduled,
  tapResponse,
} from "../helpers/mocks/expo-notifications";
import { resetSecureStore, store } from "../helpers/mocks/expo-secure-store";
import { makeRide, MIN } from "../helpers/rides";

jest.mock("expo-notifications", () =>
  require("../helpers/mocks/expo-notifications"),
);
jest.mock("expo-secure-store", () =>
  require("../helpers/mocks/expo-secure-store"),
);
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A reminder for a ride scheduled at `slotIso`, built by the real lib/reminders. */
const reminderAt = (rideId: number, slotIso: string): Reminder =>
  reminderFor(makeRide({ ride_id: rideId, scheduled_at: slotIso }), NOW)!;
const tomorrow8 = reminderAt(42, "2026-10-04T06:00:00.000Z"); // 08:00 Zagreb

const seed = (...identifiers: string[]) =>
  identifiers.forEach((identifier) =>
    scheduled.set(identifier, { identifier, content: {}, trigger: {} }),
  );
const granted = () => Object.assign(permission, { status: "granted" });
const scheduledIds = () =>
  (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(
    ([request]) => request.identifier,
  );

beforeEach(() => {
  jest.useFakeTimers({ now: NOW }); // the device clock
  setServerTime(iso(NOW), NOW); // …which agrees with the server's
  resetNotifications();
  resetSecureStore();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("reminderPermission", () => {
  it("N6: on Android the ride-reminders channel is created before permissions are checked", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    granted();

    await expect(reminderPermission({ ask: false })).resolves.toBe(true);

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      "ride-reminders",
      {
        name: "Ride reminders",
        importance: Notifications.AndroidImportance.HIGH,
      },
    );
    expect(
      (Notifications.setNotificationChannelAsync as jest.Mock).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (Notifications.getPermissionsAsync as jest.Mock).mock
        .invocationCallOrder[0],
    );
  });

  it("N6: on Android the channel also comes before the first prompt", async () => {
    jest.replaceProperty(Platform, "OS", "android");

    await reminderPermission({ ask: true });

    expect(
      (Notifications.setNotificationChannelAsync as jest.Mock).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      (Notifications.requestPermissionsAsync as jest.Mock).mock
        .invocationCallOrder[0],
    );
  });

  it("N6: iOS has no notification channels", async () => {
    await reminderPermission({ ask: true });

    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it("is granted without prompting when the OS already allows notifications", async () => {
    granted();

    await expect(reminderPermission({ ask: true })).resolves.toBe(true);

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("N3: the first ask prompts and returns the rider's answer", async () => {
    await expect(reminderPermission({ ask: true })).resolves.toBe(true);

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("N3: never prompts again after a denial, even though the OS would allow another prompt", async () => {
    permission.grantOnRequest = false;

    await expect(reminderPermission({ ask: true })).resolves.toBe(false);
    await expect(reminderPermission({ ask: true })).resolves.toBe(false);

    expect(permission.canAskAgain).toBe(true); // Android 13+ allows a second prompt
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("N3: after a reinstall the rider is asked again", async () => {
    permission.grantOnRequest = false;
    await reminderPermission({ ask: true }); // the first install: declined
    // Reinstalled: the OS forgets the answer, while the iOS Keychain keeps
    // whatever the old install stored there.
    store.set("djir.reminders.asked", "1");
    Object.assign(permission, { status: "undetermined", grantOnRequest: true });

    await expect(reminderPermission({ ask: true })).resolves.toBe(true);

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it("N3: never prompts once the OS has an answer it will not ask about again", async () => {
    Object.assign(permission, { status: "denied", canAskAgain: false });

    await expect(reminderPermission({ ask: true })).resolves.toBe(false);

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("N3: never prompts when not asked to", async () => {
    await expect(reminderPermission({ ask: false })).resolves.toBe(false);

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe("remindAbout", () => {
  it("N1: schedules one notification with id ride-{id}, the ride id as data, at the reminder time on the reminders channel", async () => {
    granted();

    await remindAbout(tomorrow8);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: "ride-42",
      content: {
        title: "Your ride is almost here",
        body: "Michael sets off at 07:53 for your 08:00 pickup.",
        data: { rideId: 42 },
      },
      trigger: {
        date: Date.parse("2026-10-04T05:43:00.000Z"),
        channelId: REMINDER_CHANNEL,
      },
    });
    expect(REMINDER_CHANNEL).toBe("ride-reminders");
  });

  it("N1 N3: asks first (in context, after booking) and schedules once allowed", async () => {
    await remindAbout(tomorrow8);

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect([...scheduled.keys()]).toEqual(["ride-42"]);
  });

  it("N3: schedules nothing when the rider declines", async () => {
    permission.grantOnRequest = false;

    await remindAbout(tomorrow8);

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("N2: a null reminder (its time has passed, or a ride now) does nothing — no prompt, no schedule", async () => {
    await remindAbout(null);

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it.each([
    ["5 min slow", 5 * MIN, "2026-10-04T05:38:00.000Z"],
    ["3 min fast", -3 * MIN, "2026-10-04T05:46:00.000Z"],
  ])(
    "N8: with the device clock %s, the OS gets the reminder time on the device clock",
    async (_, offsetMs, deviceIso) => {
      granted();
      setServerTime(iso(NOW + offsetMs), NOW);

      await remindAbout(tomorrow8); // due 05:43 on the server's clock

      expect(scheduled.get("ride-42")?.trigger).toEqual({
        date: Date.parse(deviceIso),
        channelId: "ride-reminders",
      });
    },
  );

  it("N9: a reminder already due on the device clock is skipped, not thrown", async () => {
    granted();
    jest.setSystemTime(tomorrow8.atMs); // the rider lingered on the success modal

    await expect(remindAbout(tomorrow8)).resolves.toBeUndefined();

    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe("syncReminders", () => {
  const upcoming = reminderAt(2, "2026-10-04T06:00:00.000Z");
  const added = reminderAt(3, "2026-10-05T16:30:00.000Z");

  it("N7: cancels stale ride-* reminders, keeps others' notifications, and schedules only the missing ones", async () => {
    granted();
    seed("ride-1", "ride-2", "promo-weekend");

    await syncReminders([upcoming, added]);

    expect(
      (Notifications.cancelScheduledNotificationAsync as jest.Mock).mock.calls,
    ).toEqual([["ride-1"]]);
    expect(scheduledIds()).toEqual(["ride-3"]);
    expect([...scheduled.keys()].sort()).toEqual([
      "promo-weekend",
      "ride-2",
      "ride-3",
    ]);
    expect(scheduled.get("ride-3")).toMatchObject({
      content: { data: { rideId: 3 } },
      trigger: { date: added.atMs, channelId: "ride-reminders" },
    });
  });

  it("N7: an empty history clears every ride reminder", async () => {
    granted();
    seed("ride-1", "ride-2");

    await syncReminders([]);

    expect(scheduled.size).toBe(0);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("N3 N7: without permission it does nothing, and never prompts", async () => {
    seed("ride-1");

    await syncReminders([upcoming]);

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(
      Notifications.getAllScheduledNotificationsAsync,
    ).not.toHaveBeenCalled();
    expect(
      Notifications.cancelScheduledNotificationAsync,
    ).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("N8: every reminder goes to the OS on the device clock", async () => {
    granted();
    setServerTime(iso(NOW + 5 * MIN), NOW); // the device is 5 min slow

    await syncReminders([upcoming, added]);

    expect(
      [...scheduled.values()].map((n) => (n.trigger as { date: number }).date),
    ).toEqual([upcoming.atMs - 5 * MIN, added.atMs - 5 * MIN]);
  });

  it("N9: a reminder already due on the device clock is skipped, and the rest are scheduled", async () => {
    granted();
    jest.setSystemTime(upcoming.atMs + MIN); // upcoming's reminder is due

    await syncReminders([upcoming, added]);

    expect(scheduledIds()).toEqual(["ride-3"]);
    expect([...scheduled.keys()]).toEqual(["ride-3"]);
  });

  it("N9: one reminder the OS refuses is logged, and the rest are still scheduled", async () => {
    granted();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const refused = new Error("Too many scheduled notifications");
    (
      Notifications.scheduleNotificationAsync as jest.Mock
    ).mockRejectedValueOnce(refused);

    await expect(syncReminders([upcoming, added])).resolves.toBeUndefined();

    expect(scheduledIds()).toEqual(["ride-2", "ride-3"]);
    expect([...scheduled.keys()]).toEqual(["ride-3"]);
    expect(warn).toHaveBeenCalledWith(
      "Could not schedule reminder ride-2:",
      refused,
    );
  });
});

describe("cancelling", () => {
  it("N4: cancelReminder cancels the ride's own reminder only", async () => {
    seed("ride-7", "ride-8");

    await cancelReminder(7);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      "ride-7",
    );
    expect([...scheduled.keys()]).toEqual(["ride-8"]);
  });

  it("N4: cancelAllReminders (sign-out) clears every scheduled notification", async () => {
    seed("ride-7", "ride-8");

    await cancelAllReminders();

    expect(
      Notifications.cancelAllScheduledNotificationsAsync,
    ).toHaveBeenCalledTimes(1);
    expect(scheduled.size).toBe(0);
  });
});

describe("rideIdFromResponse", () => {
  const tapped = (data: Record<string, unknown> | undefined) =>
    tapResponse("ride-42", NOW + 10 * MIN, data);

  it("N5: a tapped reminder points at its ride", () => {
    expect(rideIdFromResponse(tapped({ rideId: 42 }))).toBe(42);
  });

  it.each([
    ["a string id", { rideId: "42" }],
    ["a null id", { rideId: null }],
    ["no rideId", { url: "djir://home" }],
    ["no data", undefined],
  ])("N5: %s points nowhere", (_label, data) => {
    expect(rideIdFromResponse(tapped(data))).toBeNull();
  });

  it.each([null, undefined])(
    "N5: no response (%p) points nowhere",
    (response) => {
      expect(rideIdFromResponse(response)).toBeNull();
    },
  );
});

describe("rideToOpen (a tap opens its ride once)", () => {
  const tap = (data?: Record<string, unknown>, deliveredAt = NOW + 1 * MIN) =>
    tapResponse("ride-42", deliveredAt, data);

  it("N5: a tapped reminder opens its ride, and the tap is cleared from the OS (nothing replays it after a remount or a reload)", async () => {
    lastTap.current = tap({ rideId: 42 });

    expect(rideToOpen(lastTap.current, new Set())).toBe(42);
    await Promise.resolve();

    expect(
      Notifications.clearLastNotificationResponseAsync,
    ).toHaveBeenCalledTimes(1);
    expect(lastTap.current).toBeNull();
  });

  it("N5: the same tap handed over twice (the launch response, then the listener) opens its ride once", () => {
    const handled = new Set<string>();

    expect(rideToOpen(tap({ rideId: 42 }), handled)).toBe(42);
    expect(rideToOpen(tap({ rideId: 42 }), handled)).toBeNull();

    expect(
      Notifications.clearLastNotificationResponseAsync,
    ).toHaveBeenCalledTimes(1);
  });

  it("N5: a new delivery of the same reminder is a new tap", () => {
    const handled = new Set<string>();

    expect(rideToOpen(tap({ rideId: 42 }, NOW + 2 * MIN), handled)).toBe(42);
    expect(rideToOpen(tap({ rideId: 42 }, NOW + 3 * MIN), handled)).toBe(42);
  });

  it("N5: a notification that is not a ride reminder opens nothing, is not remembered and is not cleared", () => {
    const handled = new Set<string>();
    lastTap.current = tap({ url: "djir://home" });

    expect(rideToOpen(lastTap.current, handled)).toBeNull();

    expect(handled.size).toBe(0);
    expect(
      Notifications.clearLastNotificationResponseAsync,
    ).not.toHaveBeenCalled();
    expect(lastTap.current).not.toBeNull();
  });

  it.each([null, undefined])(
    "N5: no response (%p) opens nothing",
    (response) => {
      expect(rideToOpen(response, new Set())).toBeNull();
      expect(
        Notifications.clearLastNotificationResponseAsync,
      ).not.toHaveBeenCalled();
    },
  );

  it("N5: a clear the OS refuses is logged, and the ride still opens", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const refused = new Error("clearLastNotificationResponseAsync unavailable");
    jest
      .mocked(Notifications.clearLastNotificationResponseAsync)
      .mockRejectedValueOnce(refused);

    expect(rideToOpen(tap({ rideId: 42 }), new Set())).toBe(42);
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith(
      "Could not clear the reminder tap:",
      refused,
    );
  });
});
