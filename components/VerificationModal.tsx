import { Image, Text, View } from "react-native";

import AppModal from "@/components/AppModal";
import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import { icons, images } from "@/constants";

interface VerificationModalProps {
  visible: boolean;
  email: string;
  code: string;
  error: string | null;
  verifying: boolean;
  /**
   * The code was accepted: the same modal turns into "Verified". One modal for
   * both steps, because iOS cannot present a second modal while the first is
   * still animating away.
   */
  verified?: boolean;
  onChangeCode: (code: string) => void;
  onVerify: () => void;
  /** "Browse Home", once verified. */
  onBrowseHome?: () => void;
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
  verified = false,
  onChangeCode,
  onVerify,
  onBrowseHome,
}: VerificationModalProps) => (
  <AppModal visible={visible}>
    {verified ? (
      <View
        testID="verification-success"
        className="bg-white px-7 py-9 rounded-2xl min-h-[300px]"
      >
        <Image
          source={images.check}
          className="w-[110px] h-[110px] mx-auto my-5"
        />
        <Text
          accessibilityRole="header"
          className="text-3xl font-JakartaBold text-center"
        >
          Verified
        </Text>
        <Text className="text-base text-gray-400 font-Jakarta text-center mt-2">
          You have successfully verified your account.
        </Text>
        <CustomButton
          testID="verification-browse-home"
          title="Browse Home"
          onPress={onBrowseHome}
          className="mt-5"
        />
      </View>
    ) : (
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
          <Text
            testID="verification-error"
            className="text-red-500 text-sm mt-1"
          >
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
    )}
  </AppModal>
);

export default VerificationModal;
