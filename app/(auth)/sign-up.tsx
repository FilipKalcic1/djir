import { useSignUp } from "@clerk/clerk-expo";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, Image, ScrollView, Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import OAuth from "@/components/OAuth";
import VerificationModal from "@/components/VerificationModal";
import { icons, images } from "@/constants";
import { clerkErrorMessage, signUpParams } from "@/lib/utils";

type Step = "form" | "verifying" | "done";

const SignUp = () => {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [step, setStep] = useState<Step>("form");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignUpPress = async () => {
    if (!isLoaded) return;
    setBusy(true);
    try {
      await signUp.create(signUpParams(form));
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setCode("");
      setCodeError(null);
      setStep("verifying");
    } catch (err) {
      Alert.alert(
        "Sign up",
        clerkErrorMessage(err, "Sign up failed. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const onPressVerify = async () => {
    if (!isLoaded) return;
    setBusy(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setStep("done");
      } else {
        setCodeError("Verification failed. Please try again.");
      }
    } catch (err) {
      // Keep the modal open with the reason, so the rider can retry (R15).
      setCodeError(
        clerkErrorMessage(err, "That code didn't work. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white" keyboardShouldPersistTaps="handled">
      <View className="flex-1 bg-white">
        <View className="relative w-full h-[250px]">
          <Image source={images.signUpCar} className="z-0 w-full h-[250px]" />
          <Text className="text-2xl text-black font-JakartaSemiBold absolute bottom-5 left-5">
            Create Your Account
          </Text>
        </View>
        <View className="p-5">
          <InputField
            label="Name"
            placeholder="Enter name"
            icon={icons.person}
            value={form.name}
            onChangeText={(value) => setForm({ ...form, name: value })}
          />
          <InputField
            label="Email"
            placeholder="Enter email"
            icon={icons.email}
            textContentType="emailAddress"
            autoCapitalize="none"
            keyboardType="email-address"
            value={form.email}
            onChangeText={(value) => setForm({ ...form, email: value })}
          />
          <InputField
            label="Password"
            placeholder="Enter password"
            icon={icons.lock}
            secureTextEntry
            textContentType="password"
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />
          <CustomButton
            title="Sign Up"
            onPress={onSignUpPress}
            loading={busy}
            className="mt-6"
          />
          <OAuth />
          <Link
            href="/sign-in"
            className="text-lg text-center text-general-200 mt-10"
          >
            Already have an account?{" "}
            <Text className="text-primary-500">Log In</Text>
          </Link>
        </View>

        <VerificationModal
          visible={step === "verifying"}
          email={form.email.trim()}
          code={code}
          error={codeError}
          verifying={busy}
          onChangeCode={setCode}
          onVerify={onPressVerify}
        />

        <ReactNativeModal isVisible={step === "done"}>
          <View className="bg-white px-7 py-9 rounded-2xl min-h-[300px]">
            <Image
              source={images.check}
              className="w-[110px] h-[110px] mx-auto my-5"
            />
            <Text className="text-3xl font-JakartaBold text-center">
              Verified
            </Text>
            <Text className="text-base text-gray-400 font-Jakarta text-center mt-2">
              You have successfully verified your account.
            </Text>
            <CustomButton
              title="Browse Home"
              onPress={() => router.replace("/(root)/(tabs)/home")}
              className="mt-5"
            />
          </View>
        </ReactNativeModal>
      </View>
    </ScrollView>
  );
};

export default SignUp;
