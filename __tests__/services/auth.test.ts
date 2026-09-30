/**
 * services/auth — Clerk's token cache and the Google sign-in flow (R10).
 * SecureStore is an in-memory fake; expo-linking and Clerk's startSSOFlow
 * (useSSO, @clerk/expo 4.7) are stubbed at the boundary.
 */
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

import { NETWORK_ERROR_MESSAGE } from "@/lib/utils";
import { googleOAuth, tokenCache } from "@/services/auth";

import { resetSecureStore, store } from "../helpers/mocks/expo-secure-store";

jest.mock("expo-secure-store", () =>
  require("../helpers/mocks/expo-secure-store"),
);
jest.mock("expo-linking", () => ({
  createURL: jest.fn((path: string) => `djir://${path.replace(/^\//, "")}`),
}));

const HOME_URL = "djir://(root)/(tabs)/home";

type Flow = Parameters<typeof googleOAuth>[0];
const flow = (result: Awaited<ReturnType<Flow>>) =>
  jest.fn<ReturnType<Flow>, Parameters<Flow>>().mockResolvedValue(result);
const failingFlow = (error: unknown) =>
  jest.fn<ReturnType<Flow>, Parameters<Flow>>().mockRejectedValue(error);

let consoleError: jest.SpyInstance;
beforeEach(() => {
  resetSecureStore();
  (Linking.createURL as jest.Mock).mockClear();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("tokenCache", () => {
  it("reads a saved token", async () => {
    store.set("__clerk_client_jwt", "jwt_saved");

    await expect(tokenCache.getToken("__clerk_client_jwt")).resolves.toBe(
      "jwt_saved",
    );
  });

  it("reads null for a key that was never saved", async () => {
    await expect(tokenCache.getToken("__clerk_client_jwt")).resolves.toBeNull();
  });

  it("saves a token to SecureStore", async () => {
    await tokenCache.saveToken("__clerk_client_jwt", "jwt_new");

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "__clerk_client_jwt",
      "jwt_new",
    );
    expect(store.get("__clerk_client_jwt")).toBe("jwt_new");
  });

  it("a read failure (e.g. a keystore reset) deletes the entry and reads null", async () => {
    store.set("__clerk_client_jwt", "unreadable");
    const failure = new Error("Could not decrypt the item");
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(failure);

    await expect(tokenCache.getToken("__clerk_client_jwt")).resolves.toBeNull();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "__clerk_client_jwt",
    );
    expect(store.has("__clerk_client_jwt")).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "SecureStore read failed; clearing the entry:",
      failure,
    );
  });

  it("a write failure is logged and swallowed", async () => {
    const failure = new Error("Keychain unavailable");
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(failure);

    await expect(
      tokenCache.saveToken("__clerk_client_jwt", "jwt_new"),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "SecureStore write failed:",
      failure,
    );
  });
});

describe("googleOAuth", () => {
  it("R10: runs Clerk's Google SSO flow, redirecting back to Home through the running app's own URL", async () => {
    const startSSOFlow = flow({ createdSessionId: null });

    await googleOAuth(startSSOFlow);

    expect(Linking.createURL).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(startSSOFlow).toHaveBeenCalledTimes(1);
    expect(startSSOFlow).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectUrl: HOME_URL,
    });
  });

  it("R10: a created session is activated and the rider is signed in", async () => {
    const setActive = jest.fn(async () => {});

    const result = await googleOAuth(
      flow({ createdSessionId: "sess_1", setActive }),
    );

    expect(setActive).toHaveBeenCalledWith({ session: "sess_1" });
    expect(result).toEqual({ status: "signed-in" });
  });

  it("R10: no session (the rider closed the browser) is a cancel, and nothing is activated", async () => {
    const setActive = jest.fn(async () => {});

    const result = await googleOAuth(
      flow({ createdSessionId: null, setActive }),
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(setActive).not.toHaveBeenCalled();
  });

  it("R10: a session without setActive is a cancel", async () => {
    await expect(
      googleOAuth(flow({ createdSessionId: "sess_1" })),
    ).resolves.toEqual({ status: "cancelled" });
  });

  it("R10 R20: a Clerk error is reported with Clerk's long message", async () => {
    const clerkError = {
      errors: [
        {
          code: "external_account_exists",
          message: "Account exists",
          longMessage:
            "That Google account is already connected to another user.",
        },
      ],
    };

    await expect(googleOAuth(failingFlow(clerkError))).resolves.toEqual({
      status: "error",
      message: "That Google account is already connected to another user.",
    });
  });

  it("R10 R20: a plain error is reported with its message", async () => {
    await expect(
      googleOAuth(
        failingFlow(new Error("Another web browser is already open.")),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "Another web browser is already open.",
    });
  });

  it("R10 R20: a connection that failed is reported as one plain line, not Clerk's endpoint URL", async () => {
    const offline = new Error(
      'ClerkJS: Network error at "https://clever-cat-12.clerk.accounts.dev/v1/client/sign_ins?__clerk_api_version=2026-05-12&_clerk_js_version=6.35.0&_is_native=1" - TypeError: Network request failed. Please try again.',
    );

    await expect(googleOAuth(failingFlow(offline))).resolves.toEqual({
      status: "error",
      message: NETWORK_ERROR_MESSAGE,
    });
  });

  it("R10 R20: an error without a message falls back to a generic one", async () => {
    await expect(googleOAuth(failingFlow({}))).resolves.toEqual({
      status: "error",
      message: "Google sign-in failed. Please try again.",
    });
  });

  it("R10: a session whose activation fails once is activated on a second try, and the rider is signed in", async () => {
    // On iOS and Android, @clerk/clerk-js 6's setActive first touches the
    // session on Clerk's server, and a touch that fails (a 5xx, a 429, a
    // dropped connection) now rejects it: 2.20 ignored that failure.
    const setActive = jest
      .fn<Promise<void>, [{ session: string }]>()
      .mockRejectedValueOnce(new Error("Oops, an unexpected error occurred."))
      .mockResolvedValueOnce(undefined);

    const result = await googleOAuth(
      flow({ createdSessionId: "sess_1", setActive }),
    );

    expect(setActive.mock.calls).toEqual([
      [{ session: "sess_1" }],
      [{ session: "sess_1" }],
    ]);
    expect(result).toEqual({ status: "signed-in" });
  });

  it("R10: a session that can't be activated on the second try either is an error, not a sign-in", async () => {
    const setActive = jest.fn(async () => {
      throw new Error("Session expired");
    });

    await expect(
      googleOAuth(flow({ createdSessionId: "sess_1", setActive })),
    ).resolves.toEqual({ status: "error", message: "Session expired" });
    expect(setActive).toHaveBeenCalledTimes(2);
  });
});
