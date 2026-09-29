/**
 * The sign-up email-code step. A wrong code must leave the modal open with the
 * reason, so the rider can correct it and try again (R15).
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import palette from "tailwindcss/colors";

import VerificationModal from "@/components/VerificationModal";

type Props = React.ComponentProps<typeof VerificationModal>;

/** Renders the modal; `update` re-renders it with new props, like the screen does. */
function renderModal(props: Partial<Props> = {}) {
  const onChangeCode = jest.fn();
  const onVerify = jest.fn();
  const element = (overrides: Partial<Props>) => (
    <VerificationModal
      visible
      email="ana@example.com"
      code=""
      error={null}
      verifying={false}
      onChangeCode={onChangeCode}
      onVerify={onVerify}
      {...props}
      {...overrides}
    />
  );
  render(element({}));
  return {
    onChangeCode,
    onVerify,
    update: (overrides: Partial<Props>) => screen.rerender(element(overrides)),
  };
}

/** Lets the modal finish animating in or out. */
async function finishAnimations() {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

// The modal animates on timers; fake ones keep those frames inside the test.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("VerificationModal", () => {
  it("asks for the code sent to the rider's email", () => {
    renderModal();

    expect(screen.getByRole("header")).toHaveTextContent("Verification");
    expect(
      screen.getByText("We've sent a verification code to ana@example.com."),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("verification-error")).toBeNull();
  });

  it("shows the code it is given and reports what the rider types", () => {
    const { onChangeCode } = renderModal({ code: "123" });

    const input = screen.getByPlaceholderText("12345");
    fireEvent.changeText(input, "123456");

    expect(input).toHaveDisplayValue("123");
    expect(input).toHaveProp("keyboardType", "numeric");
    expect(onChangeCode).toHaveBeenCalledWith("123456");
  });

  it("Verify Email submits the code", () => {
    const { onVerify } = renderModal({ code: "123456" });

    fireEvent.press(screen.getByTestId("verification-submit"));

    expect(screen.getByTestId("verification-submit")).toHaveTextContent(
      "Verify Email",
    );
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it("R15: an error is shown in red and the modal stays open for another try", async () => {
    const { update } = renderModal({ code: "000000" });
    await finishAnimations();

    update({ error: "Incorrect code" });
    await finishAnimations();

    const error = screen.getByTestId("verification-error");
    expect(error).toHaveTextContent("Incorrect code");
    expect(error).toHaveStyle({ color: palette.red["500"] });
    expect(screen.getByTestId("verification-modal")).toBeOnTheScreen();
    expect(screen.getByTestId("verification-submit")).toBeEnabled();
    expect(screen.getByPlaceholderText("12345")).toHaveDisplayValue("000000");
  });

  it("R15: after an error the rider can edit the code and verify again", () => {
    const { onChangeCode, onVerify } = renderModal({
      code: "000000",
      error: "Incorrect code",
    });

    fireEvent.changeText(screen.getByPlaceholderText("12345"), "424242");
    fireEvent.press(screen.getByTestId("verification-submit"));

    expect(onChangeCode).toHaveBeenCalledWith("424242");
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it("while verifying, the button is busy and ignores presses", () => {
    const { onVerify } = renderModal({ code: "123456", verifying: true });

    const submit = screen.getByTestId("verification-submit");
    fireEvent.press(submit);

    expect(submit).toBeDisabled();
    expect(submit).toBeBusy();
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("shows nothing while not visible", () => {
    renderModal({ visible: false });

    expect(screen.queryByTestId("verification-modal")).toBeNull();
  });

  it("closes once the screen hides it", async () => {
    const { update } = renderModal();
    await finishAnimations();

    update({ visible: false });
    await finishAnimations();

    expect(screen.queryByTestId("verification-modal")).toBeNull();
  });
});
