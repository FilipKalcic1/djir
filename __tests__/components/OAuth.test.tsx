/**
 * "Log In with Google": Clerk's SSO flow (`useSSO`, @clerk/expo 4.7, which
 * deprecates `useOAuth`) is the boundary; the real googleOAuth service
 * decides signed-in / cancelled / error (R10).
 */
import { useSSO } from "@clerk/expo";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { Alert } from "react-native";

import OAuth from "@/components/OAuth";

import { resetRouter, router } from "../helpers/mocks/expo-router";
import { resetSecureStore } from "../helpers/mocks/expo-secure-store";

// The shared Clerk mock, plus @clerk/expo's useSSO.
jest.mock("@clerk/expo", () => ({
  ...require("../helpers/mocks/clerk"),
  useSSO: jest.fn(),
}));
jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("expo-secure-store", () =>
  require("../helpers/mocks/expo-secure-store"),
);
// The real createURL needs the native app manifest.
jest.mock("expo-linking", () => ({
  createURL: jest.fn((path: string) => `djir://${path}`),
}));

type FlowResult = {
  createdSessionId: string | null;
  setActive?: (params: { session: string }) => Promise<void>;
};

const startSSOFlow = jest.fn<
  Promise<FlowResult>,
  [{ strategy: string; redirectUrl: string }]
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
  startSSOFlow.mockReset();
  setActive.mockClear();
  jest
    .mocked(useSSO)
    .mockReset()
    .mockReturnValue({ startSSOFlow } as unknown as ReturnType<typeof useSSO>);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OAuth", () => {
  it("renders an 'Or' divider and the 'Log In with Google' button, and starts no flow by itself", () => {
    render(<OAuth />);

    expect(screen.getByText("Or")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Log In with Google" }),
    ).toBeOnTheScreen();
    expect(useSSO).toHaveBeenCalled();
    expect(startSSOFlow).not.toHaveBeenCalled();
  });

  it("R10: a successful sign-in runs Clerk's Google SSO flow, activates the session and lands on Home", async () => {
    startSSOFlow.mockResolvedValue({ createdSessionId: "sess_1", setActive });
    render(<OAuth />);

    await pressGoogle();

    expect(Linking.createURL).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(startSSOFlow).toHaveBeenCalledTimes(1);
    expect(startSSOFlow).toHaveBeenCalledWith({
      strategy: "oauth_google",
      redirectUrl: "djir:///(root)/(tabs)/home",
    });
    expect(setActive).toHaveBeenCalledWith({ session: "sess_1" });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(router.push).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("R10: a cancelled flow (no session) stays put without an alert", async () => {
    startSSOFlow.mockResolvedValue({ createdSessionId: null, setActive });
    render(<OAuth />);

    await pressGoogle();

    expect(setActive).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("R10: a Clerk error is explained in an alert, with no navigation", async () => {
    startSSOFlow.mockRejectedValue({
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
    startSSOFlow.mockRejectedValue(new Error(""));
    render(<OAuth />);

    await pressGoogle();

    expect(Alert.alert).toHaveBeenCalledWith(
      "Google sign-in failed",
      "Google sign-in failed. Please try again.",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("R10: if activating the session fails on its second try too, the rider is told and stays put", async () => {
    setActive
      .mockRejectedValueOnce(new Error("Session expired"))
      .mockRejectedValueOnce(new Error("Session expired"));
    startSSOFlow.mockResolvedValue({ createdSessionId: "sess_1", setActive });
    render(<OAuth />);

    await pressGoogle();

    expect(setActive).toHaveBeenCalledTimes(2);
    expect(Alert.alert).toHaveBeenCalledWith(
      "Google sign-in failed",
      "Session expired",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
