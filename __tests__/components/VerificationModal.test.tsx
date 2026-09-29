/**
 * The sign-up email-code step. A wrong code must leave the modal open with the
 * reason, so the rider can correct it and try again (R15). Once the code is
 * accepted, the same modal says "Verified".
 */
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Modal } from "react-native";
import palette from "tailwindcss/colors";

import VerificationModal from "@/components/VerificationModal";

type Props = React.ComponentProps<typeof VerificationModal>;

/** Renders the modal; `update` re-renders it with new props, like the screen does. */
function renderModal(props: Partial<Props> = {}) {
  const onChangeCode = jest.fn();
  const onVerify = jest.fn();
  const onBrowseHome = jest.fn();
  const element = (overrides: Partial<Props>) => (
    <VerificationModal
      visible
      email="ana@example.com"
      code=""
      error={null}
      verifying={false}
      onChangeCode={onChangeCode}
      onVerify={onVerify}
      onBrowseHome={onBrowseHome}
      {...props}
      {...overrides}
    />
  );
  render(element({}));
  return {
    onChangeCode,
    onVerify,
    onBrowseHome,
    update: (overrides: Partial<Props>) => screen.rerender(element(overrides)),
  };
}

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

  it("R15: an error is shown in red and the modal stays open for another try", () => {
    const { update } = renderModal({ code: "000000" });

    update({ error: "Incorrect code" });

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

  it("closes once the screen hides it", () => {
    const { update } = renderModal();

    update({ visible: false });

    expect(screen.queryByTestId("verification-modal")).toBeNull();
  });

  it("once verified, says so and offers Browse Home in place of the code form", () => {
    const { onBrowseHome, onVerify } = renderModal({ verified: true });

    const done = screen.getByTestId("verification-success");
    expect(screen.getByRole("header")).toHaveTextContent("Verified");
    expect(done).toHaveTextContent(
      /You have successfully verified your account\./,
    );
    expect(screen.queryByTestId("verification-modal")).toBeNull();
    expect(screen.queryByPlaceholderText("12345")).toBeNull();

    fireEvent.press(screen.getByTestId("verification-browse-home"));

    expect(screen.getByTestId("verification-browse-home")).toHaveTextContent(
      "Browse Home",
    );
    expect(onBrowseHome).toHaveBeenCalledTimes(1);
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("the code step and 'Verified' share one modal that stays up in between, so iOS never presents a second one", () => {
    const { update } = renderModal({ code: "424242" });
    const modal = screen.UNSAFE_getByType(Modal);

    update({ code: "424242", verified: true });

    expect(screen.UNSAFE_getAllByType(Modal)).toEqual([modal]);
    expect(modal.props.visible).toBe(true);
    expect(screen.getByTestId("verification-success")).toBeOnTheScreen();
  });
});
