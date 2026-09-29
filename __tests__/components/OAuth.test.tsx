/**
 * "Log In with Google": Clerk's OAuth flow is the boundary; the real
 * googleOAuth service decides signed-in / cancelled / error (R10).
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { Alert } from "react-native";

import OAuth from "@/components/OAuth";

import { useOAuth } from "../helpers/mocks/clerk";
import { resetRouter, router } from "../helpers/mocks/expo-router";
import { resetSecureStore } from "../helpers/mocks/expo-secure-store";

jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));
jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("expo-secure-store", () =>
  require("../helpers/mocks/expo-secure-store"),
);
// The real createURL needs the native app manifest.
jest.mock("expo-linking", () => ({
  createURL: jest.fn((path: string) => `djir://${path}`),
}));

type FlowResult = {
  createdSessionId?: string | null;
  setActive?: (params: { session: string }) => Promise<void>;
};

const startOAuthFlow = jest.fn<
  Promise<FlowResult>,
  [{ redirectUrl: string }]
>();
const setActive = jest.fn(async (_: { session: string }) => {});

async function pressGoogle() {
  await act(async () => {
    fireEvent.press(screen.getByTestId("oauth-google"));
  });
}

beforeEach(() => {
  resetRouter();
  resetSecureStore();
  startOAuthFlow.mockReset();
  setActive.mockClear();
  useOAuth.mockReset().mockReturnValue({ startOAuthFlow });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OAuth", () => {
  it("renders an 'Or' divider and the 'Log In with Google' button for the Google strategy", () => {
    render(<OAuth />);

    expect(screen.getByText("Or")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Log In with Google" }),
    ).toBeOnTheScreen();
    expect(useOAuth).toHaveBeenCalledWith({ strategy: "oauth_google" });
  });

  it("R10: a successful sign-in activates the session and lands on Home", async () => {
    startOAuthFlow.mockResolvedValue({ createdSessionId: "sess_1", setActive });
    render(<OAuth />);

    await pressGoogle();

    expect(Linking.createURL).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(startOAuthFlow).toHaveBeenCalledTimes(1);
    expect(startOAuthFlow).toHaveBeenCalledWith({
      redirectUrl: "djir:///(root)/(tabs)/home",
    });
    expect(setActive).toHaveBeenCalledWith({ session: "sess_1" });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(router.push).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("R10: a cancelled flow (no session) stays put without an alert", async () => {
    startOAuthFlow.mockResolvedValue({ createdSessionId: null, setActive });
    render(<OAuth />);

    await pressGoogle();

    expect(setActive).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("R10: a Clerk error is explained in an alert, with no navigation", async () => {
    startOAuthFlow.mockRejectedValue({
      errors: [{ longMessage: "This account has been locked." }],
    });
    render(<OAuth />);

    await pressGoogle();

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      "Google sign-in failed",
      "This account has been locked.",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("R10: an error without a message falls back to a generic one", async () => {
    startOAuthFlow.mockRejectedValue(new Error(""));
    render(<OAuth />);

    await pressGoogle();

    expect(Alert.alert).toHaveBeenCalledWith(
      "Google sign-in failed",
      "Google sign-in failed. Please try again.",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("R10: if activating the session fails, the rider is told and stays put", async () => {
    setActive.mockRejectedValueOnce(new Error("Session expired"));
    startOAuthFlow.mockResolvedValue({ createdSessionId: "sess_1", setActive });
    render(<OAuth />);

    await pressGoogle();

    expect(Alert.alert).toHaveBeenCalledWith(
      "Google sign-in failed",
      "Session expired",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
