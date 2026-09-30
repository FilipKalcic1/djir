/**
 * The sign-in screen against a fake Clerk: a completed sign-in lands on Home,
 * and the link to sign-up swaps screens rather than stacking them (in
 * expo-router 57 a plain Link pushes, so switching back and forth between
 * sign-in and sign-up would pile up screens). The fake stands in for
 * @clerk/expo/legacy, which keeps Clerk's Core 2 useSignIn (EG8); @clerk/expo's
 * own useSignIn is Core 3's, a different API.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import SignIn from "@/app/(auth)/sign-in";
import { NETWORK_ERROR_MESSAGE } from "@/lib/utils";

import { resetRouter, router } from "../helpers/mocks/expo-router";
import { resetSecureStore } from "../helpers/mocks/expo-secure-store";

const mockClerk = {
  isLoaded: true,
  signIn: { create: jest.fn() },
  setActive: jest.fn(),
};

jest.mock("@clerk/expo/legacy", () => ({
  useSignIn: () => mockClerk,
}));
// Google sign-in has its own test (components/OAuth).
jest.mock("@/components/OAuth", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("expo-router", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    ...require("../helpers/mocks/expo-router"),
    // A Text that keeps the Link's props (href, dismissTo, …).
    Link: ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement(Text, { testID: "link", ...props }, children),
  };
});
jest.mock("expo-secure-store", () =>
  require("../helpers/mocks/expo-secure-store"),
);

async function signInAs(email: string, password: string) {
  fireEvent.changeText(screen.getByPlaceholderText("Enter email"), email);
  fireEvent.changeText(screen.getByPlaceholderText("Enter password"), password);
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Sign In" }));
  });
}

beforeEach(() => {
  resetRouter();
  resetSecureStore();
  mockClerk.isLoaded = true;
  mockClerk.signIn.create.mockReset();
  mockClerk.setActive.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("sign-in", () => {
  it("the Sign Up link swaps to sign-up rather than stacking it (expo-router 57's Link pushes by default)", () => {
    render(<SignIn />);

    const link = screen.getByTestId("link");
    expect(link).toHaveTextContent("Don't have an account? Sign Up");
    expect(link).toHaveProp("href", "/sign-up");
    expect(link).toHaveProp("dismissTo", true);
  });

  it("EG8: a completed sign-in activates the session and replaces the stack with Home", async () => {
    mockClerk.signIn.create.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_1",
    });
    render(<SignIn />);

    await signInAs(" ana@example.com ", "correct horse battery");

    expect(mockClerk.signIn.create).toHaveBeenCalledWith({
      identifier: "ana@example.com",
      password: "correct horse battery",
    });
    expect(mockClerk.setActive).toHaveBeenCalledWith({ session: "sess_1" });
    expect(router.replace).toHaveBeenCalledWith("/(root)/(tabs)/home");
  });

  it("EG8: a completed sign-in whose activation fails once is activated on a second try and lands on Home", async () => {
    // On iOS and Android, @clerk/clerk-js 6's setActive first touches the
    // session on Clerk's server, and a touch that fails (a 5xx, a 429, a
    // dropped connection) now rejects it: 2.20 ignored that failure.
    mockClerk.signIn.create.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_1",
    });
    mockClerk.setActive.mockRejectedValueOnce(
      new Error("Oops, an unexpected error occurred."),
    );
    render(<SignIn />);

    await signInAs("ana@example.com", "correct horse battery");

    expect(mockClerk.setActive.mock.calls).toEqual([
      [{ session: "sess_1" }],
      [{ session: "sess_1" }],
    ]);
    expect(router.replace).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("EG8: a session that can't be activated on the second try either is explained in an alert, and the rider stays here", async () => {
    mockClerk.signIn.create.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_1",
    });
    mockClerk.setActive.mockRejectedValue(
      new Error(
        'ClerkJS: Network error at "https://clever-cat-12.clerk.accounts.dev/v1/client/sessions/sess_1/touch?__clerk_api_version=2026-05-12&_clerk_js_version=6.35.0&_is_native=1" - TypeError: Network request failed. Please try again.',
      ),
    );
    render(<SignIn />);

    await signInAs("ana@example.com", "correct horse battery");

    expect(mockClerk.setActive).toHaveBeenCalledTimes(2);
    expect(Alert.alert).toHaveBeenCalledWith("Sign in", NETWORK_ERROR_MESSAGE);
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });

  it("EG8: after that, Sign In for the same email retries only the activation — Clerk now holds that session and would refuse a second sign-in — and lands on Home", async () => {
    mockClerk.signIn.create.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_1",
    });
    mockClerk.setActive
      .mockRejectedValueOnce(new Error("Oops, an unexpected error occurred."))
      .mockRejectedValueOnce(new Error("Oops, an unexpected error occurred."));
    render(<SignIn />);
    await signInAs("ana@example.com", "correct horse battery");
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Sign In" }));
    });

    expect(mockClerk.signIn.create).toHaveBeenCalledTimes(1);
    expect(mockClerk.setActive.mock.calls).toEqual([
      [{ session: "sess_1" }],
      [{ session: "sess_1" }],
      [{ session: "sess_1" }],
    ]);
    expect(router.replace).toHaveBeenCalledWith("/(root)/(tabs)/home");
  });

  it("EG8: a different email after that is a sign-in of its own, never the first account's session", async () => {
    mockClerk.signIn.create
      .mockResolvedValueOnce({ status: "complete", createdSessionId: "sess_1" })
      .mockResolvedValueOnce({
        status: "complete",
        createdSessionId: "sess_2",
      });
    mockClerk.setActive
      .mockRejectedValueOnce(new Error("Oops, an unexpected error occurred."))
      .mockRejectedValueOnce(new Error("Oops, an unexpected error occurred."));
    render(<SignIn />);
    await signInAs("ana@example.com", "correct horse battery");

    await signInAs("ivo@example.com", "another horse battery");

    expect(mockClerk.signIn.create).toHaveBeenCalledTimes(2);
    expect(mockClerk.signIn.create).toHaveBeenLastCalledWith({
      identifier: "ivo@example.com",
      password: "another horse battery",
    });
    expect(mockClerk.setActive).toHaveBeenLastCalledWith({ session: "sess_2" });
    expect(router.replace).toHaveBeenCalledWith("/(root)/(tabs)/home");
  });

  it("a rejected sign-in is explained in an alert and stays here", async () => {
    mockClerk.signIn.create.mockRejectedValue({
      errors: [{ longMessage: "Password is incorrect." }],
    });
    render(<SignIn />);

    await signInAs("ana@example.com", "wrong");

    expect(Alert.alert).toHaveBeenCalledWith(
      "Sign in",
      "Password is incorrect.",
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });
});
