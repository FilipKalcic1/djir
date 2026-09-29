import { ClerkLoaded, ClerkProvider } from "@clerk/clerk-expo";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

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

  return (
    <GestureHandlerRootView style={styles.root}>
      {canStart(checks) ? (
        <ClerkProvider
          tokenCache={tokenCache}
          publishableKey={keys.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY}
        >
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
      ) : (
        <SetupNeeded checks={checks} />
      )}
    </GestureHandlerRootView>
  );
}
