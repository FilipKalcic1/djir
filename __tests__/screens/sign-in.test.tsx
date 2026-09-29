/**
 * The sign-in screen against a fake Clerk: a completed sign-in lands on Home,
 * and the link to sign-up swaps screens rather than stacking them (in
 * expo-router 57 a plain Link pushes, so switching back and forth between
 * sign-in and sign-up would pile up screens).
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import SignIn from "@/app/(auth)/sign-in";

import { resetRouter, router } from "../helpers/mocks/expo-router";
import { resetSecureStore } from "../helpers/mocks/expo-secure-store";

const mockClerk = {
  isLoaded: true,
  signIn: { create: jest.fn() },
  setActive: jest.fn(),
};

jest.mock("@clerk/clerk-expo", () => ({
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

  it("a completed sign-in activates the session and replaces the stack with Home", async () => {
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
