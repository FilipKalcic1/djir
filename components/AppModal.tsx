import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
} from "react-native";

interface AppModalProps {
  visible: boolean;
  children: React.ReactNode;
  /** A tap on the dimmed backdrop. Leave it out and the backdrop does nothing. */
  onBackdropPress?: () => void;
  /**
   * Android's back button (and the system dismiss gesture). Leave it out and
   * back does nothing while the modal is open.
   */
  onRequestClose?: () => void;
}

/** The dimmed backdrop (react-native-modal's default: black at 70%). */
const BACKDROP = "rgba(0, 0, 0, 0.7)";

const styles = StyleSheet.create({
  // Centred, 5% in from each side, as react-native-modal laid it out.
  frame: { flex: 1, justifyContent: "center", paddingHorizontal: "5%" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: BACKDROP },
});

/**
 * A centred card over a dimmed backdrop, on React Native's own Modal.
 * It replaces react-native-modal 13, which calls
 * `BackHandler.removeEventListener` on unmount; React Native 0.86 has no such
 * method, so every modal crashed the screen that closed it. Android back
 * reaches `onRequestClose`; the backdrop only closes the modal when asked to.
 */
const AppModal = ({
  visible,
  children,
  onBackdropPress,
  onRequestClose,
}: AppModalProps) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    statusBarTranslucent
    onRequestClose={() => onRequestClose?.()}
  >
    <KeyboardAvoidingView
      style={styles.frame}
      // A code or address field in the card stays above the keyboard.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Pressable
        testID="modal-backdrop"
        style={styles.backdrop}
        onPress={onBackdropPress}
        accessible={false}
      />
      {children}
    </KeyboardAvoidingView>
  </Modal>
);

export default AppModal;
