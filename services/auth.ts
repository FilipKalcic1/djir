/** services/auth.ts — Clerk session storage and the Google sign-in flow. */

import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

import { clerkErrorMessage } from "@/lib/utils";

/** Clerk's token cache, backed by the device keychain / keystore. */
export const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.error("SecureStore read failed; clearing the entry:", error);
      await SecureStore.deleteItemAsync(key);
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.error("SecureStore write failed:", error);
    }
  },
};

export type OAuthResult =
  | { status: "signed-in" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Clerk's `startSSOFlow` (`useSSO()`, @clerk/clerk-expo 2.20, which deprecates
 * `useOAuth`), as far as the Google sign-in uses it.
 */
export type StartSSOFlow = (params: {
  strategy: "oauth_google";
  redirectUrl: string;
}) => Promise<{
  createdSessionId: string | null;
  setActive?: (params: { session: string }) => Promise<void>;
}>;

/**
 * Run Clerk's Google SSO flow and activate the session it creates. The
 * redirect comes from expo-linking, so it names the app that is running:
 * `exp://<dev server>/--/…` in Expo Go, `djir://…` in a build.
 */
export async function googleOAuth(
  startSSOFlow: StartSSOFlow,
): Promise<OAuthResult> {
  try {
    const { createdSessionId, setActive } = await startSSOFlow({
      strategy: "oauth_google",
      redirectUrl: Linking.createURL("/(root)/(tabs)/home"),
    });
    if (!createdSessionId || !setActive) return { status: "cancelled" };
    await setActive({ session: createdSessionId });
    return { status: "signed-in" };
  } catch (error) {
    return {
      status: "error",
      message: clerkErrorMessage(
        error,
        "Google sign-in failed. Please try again.",
      ),
    };
  }
}
