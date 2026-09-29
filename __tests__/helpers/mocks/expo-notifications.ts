/**
 * expo-notifications with an in-memory schedule and an OS permission that
 * behaves like the real one: "undetermined" until the one prompt, then
 * "granted" or "denied"; a reinstall resets it to "undetermined". The OS also
 * keeps the last notification response (`lastTap`) — across remounts and JS
 * reloads — until `clearLastNotificationResponseAsync()`, and
 * `useLastNotificationResponse` reads it as the SDK's hook does.
 * `jest.mock("expo-notifications", () => require("../helpers/mocks/expo-notifications"))`.
 */
import { useEffect, useState } from "react";

import type { NotificationResponse } from "expo-notifications";

type Scheduled = { identifier: string; content: unknown; trigger: unknown };
type Status = "undetermined" | "granted" | "denied";

export const scheduled = new Map<string, Scheduled>();
export const permission = {
  status: "undetermined" as Status,
  canAskAgain: true,
  grantOnRequest: true,
};

const permissionResponse = () => ({
  status: permission.status,
  granted: permission.status === "granted",
  canAskAgain: permission.canAskAgain,
});

export const AndroidImportance = { HIGH: 4 };
export const setNotificationChannelAsync = jest.fn(async () => null);
export const getPermissionsAsync = jest.fn(async () => permissionResponse());
export const requestPermissionsAsync = jest.fn(async () => {
  permission.status = permission.grantOnRequest ? "granted" : "denied";
  return permissionResponse();
});
/** Like iOS, refuses a date trigger that is not in the future (device clock). */
export const scheduleNotificationAsync = jest.fn(
  async (request: {
    identifier: string;
    content: unknown;
    trigger: unknown;
  }) => {
    const date = (request.trigger as { date?: unknown } | null)?.date;
    if (typeof date === "number" && date <= Date.now()) {
      throw new Error("The trigger date must be in the future");
    }
    scheduled.set(request.identifier, request);
    return request.identifier;
  },
);
export const getAllScheduledNotificationsAsync = jest.fn(async () => [
  ...scheduled.values(),
]);
export const cancelScheduledNotificationAsync = jest.fn(async (id: string) => {
  scheduled.delete(id);
});
export const cancelAllScheduledNotificationsAsync = jest.fn(async () => {
  scheduled.clear();
});
export const setNotificationHandler = jest.fn();

/** The OS's last notification response; `null` when there is none. */
export const lastTap = { current: null as NotificationResponse | null };
const tapListeners = new Set<
  (response: NotificationResponse | undefined) => void
>();

/** The rider taps a notification while the app runs: every hook hears it. */
export function receiveTap(response: NotificationResponse) {
  lastTap.current = response;
  tapListeners.forEach((listener) => listener(response));
}

export const clearLastNotificationResponseAsync = jest.fn(async () => {
  lastTap.current = null;
  tapListeners.forEach((listener) => listener(undefined));
});

/**
 * Like the SDK's hook: the OS's last response on mount, then each new tap;
 * `undefined` once it is cleared.
 */
function useLastResponse(): NotificationResponse | null | undefined {
  const [response, setResponse] = useState<NotificationResponse | undefined>(
    () => lastTap.current ?? undefined,
  );
  useEffect(() => {
    tapListeners.add(setResponse);
    return () => {
      tapListeners.delete(setResponse);
    };
  }, []);
  return response;
}
export const useLastNotificationResponse = jest.fn(useLastResponse);

/** A tap on the notification `identifier` delivered at `date`, carrying `data`. */
export const tapResponse = (
  identifier: string,
  date: number,
  data?: Record<string, unknown>,
) =>
  ({
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: {
      date,
      request: {
        identifier,
        content: { title: "t", body: "b", data },
        trigger: null,
      },
    },
  }) as unknown as NotificationResponse;

export function resetNotifications() {
  scheduled.clear();
  lastTap.current = null;
  Object.assign(permission, {
    status: "undetermined",
    canAskAgain: true,
    grantOnRequest: true,
  });
  for (const fn of [
    setNotificationChannelAsync,
    getPermissionsAsync,
    requestPermissionsAsync,
    scheduleNotificationAsync,
    getAllScheduledNotificationsAsync,
    cancelScheduledNotificationAsync,
    cancelAllScheduledNotificationsAsync,
    setNotificationHandler,
    clearLastNotificationResponseAsync,
    useLastNotificationResponse,
  ]) {
    fn.mockClear();
  }
}
