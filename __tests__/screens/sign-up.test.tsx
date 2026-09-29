/**
 * The sign-up screen against a fake Clerk: the name reaches Clerk (R21), and a
 * wrong email code keeps the verification modal open with the reason (R15).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { Alert } from "react-native";

import SignUp from "@/app/(auth)/sign-up";

import { resetRouter, router } from "../helpers/mocks/expo-router";
import { resetSecureStore } from "../helpers/mocks/expo-secure-store";

const mockClerk = {
  isLoaded: true,
  signUp: {
    create: jest.fn(),
    prepareEmailAddressVerification: jest.fn(),
    attemptEmailAddressVerification: jest.fn(),
  },
  setActive: jest.fn(),
};

jest.mock("@clerk/clerk-expo", () => ({
  useSignUp: () => mockClerk,
  useOAuth: () => ({ startOAuthFlow: jest.fn() }),
}));
jest.mock("expo-router", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    ...require("../helpers/mocks/expo-router"),
    Link: ({ children }: { children: React.ReactNode }) =>
      React.createElement(Text, null, children),
  };
});
jest.mock("expo-secure-store", () =>
  require("../helpers/mocks/expo-secure-store"),
);

const WRONG_CODE = { errors: [{ longMessage: "Incorrect code" }] };

function fillForm(name: string, email: string, password: string) {
  fireEvent.changeText(screen.getByPlaceholderText("Enter name"), name);
  fireEvent.changeText(screen.getByPlaceholderText("Enter email"), email);
  fireEvent.changeText(screen.getByPlaceholderText("Enter password"), password);
}

async function press(name: string) {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
}

/** Lets the modals finish animating in or out. */
async function finishAnimations() {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

/** Types a code and submits it; a modal that is going to close has closed. */
async function enterCode(code: string) {
  fireEvent.changeText(screen.getByPlaceholderText("12345"), code);
  await act(async () => {
    fireEvent.press(screen.getByTestId("verification-submit"));
  });
  await finishAnimations();
}

/** Fills the form and submits it, reaching the verification step. */
async function signUpAs(name = "Ana Horvat") {
  render(<SignUp />);
  fillForm(name, "ana@example.com", "correct horse battery");
  await press("Sign Up");
  await finishAnimations();
}

// The modals animate on timers; fake ones keep those frames inside the test.
beforeEach(() => {
  jest.useFakeTimers();
  resetRouter();
  resetSecureStore();
  mockClerk.isLoaded = true;
  mockClerk.signUp.create.mockReset().mockResolvedValue({});
  mockClerk.signUp.prepareEmailAddressVerification
    .mockReset()
    .mockResolvedValue({});
  mockClerk.signUp.attemptEmailAddressVerification.mockReset();
  mockClerk.setActive.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("sign-up — creating the account (R21)", () => {
  it("R21: the entered name goes to Clerk as unsafeMetadata, with the trimmed email", async () => {
    render(<SignUp />);
    fillForm("  Ana Horvat ", " ana@example.com ", "correct horse battery");

    await press("Sign Up");

    expect(mockClerk.signUp.create).toHaveBeenCalledTimes(1);
    expect(mockClerk.signUp.create).toHaveBeenCalledWith({
      emailAddress: "ana@example.com",
      password: "correct horse battery",
      unsafeMetadata: { name: "Ana Horvat" },
    });
    expect(
      mockClerk.signUp.prepareEmailAddressVerification,
    ).toHaveBeenCalledWith({ strategy: "email_code" });
  });

  it("R21: a blank name sends no unsafeMetadata", async () => {
    await signUpAs("   ");

    expect(mockClerk.signUp.create).toHaveBeenCalledWith({
      emailAddress: "ana@example.com",
      password: "correct horse battery",
    });
  });

  it("after sign-up the verification modal asks for the code sent to the email", async () => {
    render(<SignUp />);
    fillForm("Ana", " ana@example.com ", "correct horse battery");
    expect(screen.queryByTestId("verification-modal")).toBeNull();

    await press("Sign Up");

    expect(
      within(screen.getByTestId("verification-modal")).getByText(
        "We've sent a verification code to ana@example.com.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("verification-error")).toBeNull();
  });

  it("a rejected sign-up is explained in an alert and no modal opens", async () => {
    mockClerk.signUp.create.mockRejectedValue({
      errors: [{ longMessage: "That email address is taken." }],
    });
    render(<SignUp />);
    fillForm("Ana", "ana@example.com", "correct horse battery");

    await press("Sign Up");

    expect(Alert.alert).toHaveBeenCalledWith(
      "Sign up",
      "That email address is taken.",
    );
    expect(
      mockClerk.signUp.prepareEmailAddressVerification,
    ).not.toHaveBeenCalled();
    expect(screen.queryByTestId("verification-modal")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeEnabled();
  });

  it("does nothing until Clerk has loaded", async () => {
    mockClerk.isLoaded = false;
    render(<SignUp />);
    fillForm("Ana", "ana@example.com", "correct horse battery");

    await press("Sign Up");

    expect(mockClerk.signUp.create).not.toHaveBeenCalled();
    expect(screen.queryByTestId("verification-modal")).toBeNull();
  });
});

describe("sign-up — verifying the email (R15)", () => {
  it("R15: a wrong code keeps the modal open with Clerk's reason", async () => {
    mockClerk.signUp.attemptEmailAddressVerification.mockRejectedValue(
      WRONG_CODE,
    );
    await signUpAs();

    await enterCode(" 000000 ");

    expect(
      mockClerk.signUp.attemptEmailAddressVerification,
    ).toHaveBeenCalledWith({ code: "000000" });
    expect(screen.getByTestId("verification-modal")).toBeOnTheScreen();
    expect(screen.getByTestId("verification-error")).toHaveTextContent(
      "Incorrect code",
    );
    expect(screen.getByTestId("verification-submit")).toBeEnabled();
    expect(mockClerk.setActive).not.toHaveBeenCalled();
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("R15: an incomplete verification also keeps the modal open, with a generic reason", async () => {
    mockClerk.signUp.attemptEmailAddressVerification.mockResolvedValue({
      status: "missing_requirements",
    });
    await signUpAs();

    await enterCode("123456");

    expect(screen.getByTestId("verification-modal")).toBeOnTheScreen();
    expect(screen.getByTestId("verification-error")).toHaveTextContent(
      "Verification failed. Please try again.",
    );
    expect(mockClerk.setActive).not.toHaveBeenCalled();
  });

  it("R15: after a wrong code the rider can retry, and the right one signs them in", async () => {
    mockClerk.signUp.attemptEmailAddressVerification
      .mockRejectedValueOnce(WRONG_CODE)
      .mockResolvedValueOnce({
        status: "complete",
        createdSessionId: "sess_1",
      });
    await signUpAs();
    await enterCode("000000");

    await enterCode("424242");

    expect(
      mockClerk.signUp.attemptEmailAddressVerification,
    ).toHaveBeenLastCalledWith({ code: "424242" });
    expect(mockClerk.setActive).toHaveBeenCalledWith({ session: "sess_1" });
    expect(screen.getByText("Verified")).toBeOnTheScreen();
    expect(
      screen.getByText("You have successfully verified your account."),
    ).toBeOnTheScreen();
  });

  it("once verified, Browse Home replaces the stack with Home", async () => {
    mockClerk.signUp.attemptEmailAddressVerification.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_1",
    });
    await signUpAs();
    await enterCode("424242");

    await press("Browse Home");

    expect(screen.queryByTestId("verification-modal")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/(root)/(tabs)/home");
  });
});
