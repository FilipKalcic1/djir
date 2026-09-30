import {
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  useClerk,
} from "@clerk/expo";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

import ClerkUnreachable from "@/components/ClerkUnreachable";
import SetupNeeded from "@/components/SetupNeeded";
import { canStart, checkAppKeys } from "@/lib/setup";
import { tokenCache } from "@/services/auth";
import { appKeyValues } from "@/services/setup";

// Keep the splash screen up until the fonts are ready (called at module scope,
// as expo-splash-screen asks, so it is not too late).
SplashScreen.preventAutoHideAsync();

// Show ride reminders even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

LogBox.ignoreLogs(["Clerk:"]);

const styles = StyleSheet.create({ root: { flex: 1 } });

/** Calls `onFail` once Clerk's load has failed (its status is "error"). */
const OnClerkFailure = ({ onFail }: { onFail: () => void }) => {
  const { status } = useClerk();
  useEffect(() => {
    if (status === "error") onFail();
  }, [status, onFail]);
  return null;
};

/**
 * The app, under Clerk. When Clerk can't be reached as the app starts,
 * @clerk/clerk-js 6 gives up after four tries of each request (about 3.5 s)
 * and never tries again, so ClerkLoaded would leave the screen blank for
 * good: "Can't connect" takes the provider's place instead (EG8). A load
 * belongs to the provider's mount, and a provider remounted within the same
 * render keeps the failed one, so Retry mounts a new provider once the old
 * one is gone; the screen stays up, busy, until Clerk has loaded or failed
 * again.
 */
const ClerkApp = ({ publishableKey }: { publishableKey: string }) => {
  const [unreachable, setUnreachable] = useState(false);
  const [retried, setRetried] = useState(false);

  if (unreachable) {
    return (
      <ClerkUnreachable
        onRetry={() => {
          setRetried(true);
          setUnreachable(false);
        }}
      />
    );
  }
  return (
    <ClerkProvider tokenCache={tokenCache} publishableKey={publishableKey}>
      <OnClerkFailure onFail={() => setUnreachable(true)} />
      {retried && (
        <ClerkLoading>
          <ClerkUnreachable retrying />
        </ClerkLoading>
      )}
      <ClerkLoaded>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(root)" options={{ headerShown: false }} />
          <Stack.Screen
            name="stripe-redirect"
            options={{ headerShown: false }}
          />
          <Stack.Screen name="+not-found" />
        </Stack>
      </ClerkLoaded>
    </ClerkProvider>
  );
};

/**
 * The app's root. Without a valid EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY there is
 * nothing to sign in to, and ClerkProvider would throw: the "Setup needed"
 * screen says what to add instead (EG1). Everything sits in one
 * GestureHandlerRootView, which @gorhom/bottom-sheet v5 needs at the root
 * (EG7).
 */
export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    "Jakarta-Bold": require("../assets/fonts/PlusJakartaSans-Bold.ttf"),
    "Jakarta-ExtraBold": require("../assets/fonts/PlusJakartaSans-ExtraBold.ttf"),
    "Jakarta-ExtraLight": require("../assets/fonts/PlusJakartaSans-ExtraLight.ttf"),
    "Jakarta-Light": require("../assets/fonts/PlusJakartaSans-Light.ttf"),
    "Jakarta-Medium": require("../assets/fonts/PlusJakartaSans-Medium.ttf"),
    Jakarta: require("../assets/fonts/PlusJakartaSans-Regular.ttf"),
    "Jakarta-SemiBold": require("../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
  });
  // A font that fails to load falls back to the system font: never a splash forever.
  const ready = loaded || fontError !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const keys = appKeyValues();
  const checks = checkAppKeys(keys);
  // Set only when every check passes. @clerk/expo 4 requires the key as a
  // prop: it no longer falls back to process.env itself.
  const clerkKey = canStart(checks)
    ? keys.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
    : undefined;

  return (
    <GestureHandlerRootView style={styles.root}>
      {clerkKey ? (
        <ClerkApp publishableKey={clerkKey} />
      ) : (
        <SetupNeeded checks={checks} />
      )}
    </GestureHandlerRootView>
  );
}
