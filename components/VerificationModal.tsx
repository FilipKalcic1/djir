import { Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { icons } from "@/constants";

interface VerificationModalProps {
  visible: boolean;
  email: string;
  code: string;
  error: string | null;
  verifying: boolean;
  onChangeCode: (code: string) => void;
  onVerify: () => void;
}

/**
 * The email-code step of sign-up. A wrong code keeps the modal open with the
 * error, so the rider can simply try again (R15).
 */
const VerificationModal = ({
  visible,
  email,
  code,
  error,
  verifying,
  onChangeCode,
  onVerify,
}: VerificationModalProps) => (
  <ReactNativeModal isVisible={visible}>
    <View
      testID="verification-modal"
      className="bg-white px-7 py-9 rounded-2xl min-h-[300px]"
    >
      <Text
        accessibilityRole="header"
        className="font-JakartaExtraBold text-2xl mb-2"
      >
        Verification
      </Text>
      <Text className="font-Jakarta mb-5">
        We've sent a verification code to {email}.
      </Text>
      <InputField
        label="Code"
        icon={icons.lock}
        placeholder="12345"
        value={code}
        keyboardType="numeric"
        onChangeText={onChangeCode}
      />
      {error ? (
        <Text testID="verification-error" className="text-red-500 text-sm mt-1">
          {error}
        </Text>
      ) : null}
      <CustomButton
        testID="verification-submit"
        title="Verify Email"
        onPress={onVerify}
        loading={verifying}
        bgVariant="success"
        className="mt-5"
      />
    </View>
  </ReactNativeModal>
);

export default VerificationModal;
