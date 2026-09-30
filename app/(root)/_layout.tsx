import { useAuth } from "@clerk/expo";
import * as Notifications from "expo-notifications";
import { router, Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { useEffect, useRef } from "react";

import AuthGate from "@/components/AuthGate";
import { useDriverQuotes } from "@/hooks/useDriverQuotes";
import { trackRideHref } from "@/lib/rides";
import { rideToOpen } from "@/services/reminders";

/** Owns the booking data for every screen below (drivers + the trip quote). */
const BookingData = () => {
  useDriverQuotes();
  return null;
};

/**
 * A tapped ride reminder opens that ride — whether the app was running or not
 * — once: the tap is then cleared, since the hook hands the OS's last tap to
 * every new mount (N5). A ride whose tracker is already on screen stays as it
 * is, rather than getting a second tracker on top.
 */
const ReminderTaps = () => {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef(new Set<string>()); // taps this mount acted on
  const pathname = usePathname();
  const { rideId: shownRideId } = useGlobalSearchParams<{ rideId?: string }>();
  // Read when a tap arrives; a navigation alone must not re-run the effect.
  const onScreen = useRef({ pathname, shownRideId });
  onScreen.current = { pathname, shownRideId };
  useEffect(() => {
    const rideId = rideToOpen(response, handled.current);
    if (rideId === null) return;
    const { pathname: path, shownRideId: shown } = onScreen.current;
    if (path === "/track-ride" && shown === String(rideId)) return;
    router.push(trackRideHref(rideId));
  }, [response]);
  return null;
};

const Layout = () => {
  const { isSignedIn } = useAuth();
  return (
    <AuthGate isSignedIn={isSignedIn}>
      <BookingData />
      <ReminderTaps />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="find-ride" />
        <Stack.Screen name="confirm-ride" />
        <Stack.Screen name="book-ride" />
        <Stack.Screen name="track-ride" />
      </Stack>
    </AuthGate>
  );
};

export default Layout;
