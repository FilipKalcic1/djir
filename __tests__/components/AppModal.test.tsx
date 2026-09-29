/**
 * AppModal: the centred card over a dimmed backdrop that replaced
 * react-native-modal 13, whose unmount called BackHandler.removeEventListener —
 * a method React Native 0.86 no longer has, so every modal crashed its screen.
 * It sits on React Native's own Modal (jest's mock renders the children while
 * visible; its onRequestClose is Android's back button).
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Text,
  View,
} from "react-native";

import AppModal from "@/components/AppModal";

type Props = Partial<React.ComponentProps<typeof AppModal>>;

/**
 * Android's back button: the native Modal calls its own onRequestClose (called
 * on the Modal itself, so a handler that only sits on AppModal's props would
 * not count).
 */
const pressAndroidBack = () =>
  act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());

function renderModal(props: Props = {}) {
  const element = (overrides: Props) => (
    <AppModal visible {...props} {...overrides}>
      <View testID="card">
        <Text>Card</Text>
      </View>
    </AppModal>
  );
  const view = render(element({}));
  return {
    ...view,
    update: (overrides: Props) => view.rerender(element(overrides)),
  };
}

describe("AppModal", () => {
  it("shows its card over a backdrop dimmed to black at 70% while visible", () => {
    renderModal();

    expect(screen.getByTestId("card")).toBeOnTheScreen();
    expect(screen.getByTestId("modal-backdrop")).toHaveStyle({
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it("shows nothing while not visible", () => {
    renderModal({ visible: false });

    expect(screen.queryByTestId("card")).toBeNull();
    expect(screen.queryByTestId("modal-backdrop")).toBeNull();
  });

  it("is React Native's own Modal: transparent, fading in and out", () => {
    renderModal();

    const modal = screen.UNSAFE_getByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    expect(modal.props.animationType).toBe("fade");
  });

  it("closes and unmounts without a crash on React Native 0.86, which has no BackHandler.removeEventListener", () => {
    const view = renderModal();

    view.update({ visible: false });

    expect(screen.queryByTestId("card")).toBeNull();
    expect(
      (BackHandler as unknown as Record<string, unknown>).removeEventListener,
    ).toBeUndefined();
    expect(() => view.unmount()).not.toThrow();
  });

  it("a backdrop tap calls onBackdropPress", () => {
    const onBackdropPress = jest.fn();
    const onRequestClose = jest.fn();
    renderModal({ onBackdropPress, onRequestClose });

    fireEvent.press(screen.getByTestId("modal-backdrop"));

    expect(onBackdropPress).toHaveBeenCalledTimes(1);
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("without onBackdropPress, a backdrop tap does nothing and the card stays", () => {
    renderModal();

    fireEvent.press(screen.getByTestId("modal-backdrop"));

    expect(screen.getByTestId("card")).toBeOnTheScreen();
  });

  it("Android back calls onRequestClose, not the backdrop's handler", () => {
    const onBackdropPress = jest.fn();
    const onRequestClose = jest.fn();
    renderModal({ onBackdropPress, onRequestClose });

    pressAndroidBack();

    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onBackdropPress).not.toHaveBeenCalled();
  });

  it("without onRequestClose, Android back does nothing and the card stays", () => {
    renderModal();

    pressAndroidBack();

    expect(screen.getByTestId("card")).toBeOnTheScreen();
  });

  it("keeps a field in the card above the iOS keyboard", () => {
    renderModal();

    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe(
      "padding",
    );
  });
});
