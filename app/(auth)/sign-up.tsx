import { useSignUp } from "@clerk/expo/legacy";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, Image, ScrollView, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import OAuth from "@/components/OAuth";
import VerificationModal from "@/components/VerificationModal";
import { icons, images } from "@/constants";
import { clerkErrorMessage, signUpParams } from "@/lib/utils";
import { activateSession } from "@/services/auth";

type Step = "form" | "verifying" | "done";

/**
 * The code was accepted, but the new account's session could not be made
 * active (R15): Verify Email now retries only that.
 */
const ACCOUNT_READY =
  "Your account is ready, but we couldn't sign you in. Check your connection and tap Verify Email again.";

const SignUp = () => {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [step, setStep] = useState<Step>("form");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The session of an account whose code was accepted, but which could not
  // be made active. Clerk holds it for this phone and would refuse the spent
  // code, and a second sign-in too, so Verify retries only the activation.
  const [unactivated, setUnactivated] = useState<{
    session: string | null;
  } | null>(null);

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
      let session: string | null;
      if (unactivated) {
        session = unactivated.session;
      } else {
        const result = await signUp.attemptEmailAddressVerification({
          code: code.trim(),
        });
        if (result.status !== "complete") {
          setCodeError("Verification failed. Please try again.");
          return;
        }
        session = result.createdSessionId;
      }
      try {
        await activateSession(setActive, session);
      } catch {
        setUnactivated({ session });
        setCodeError(ACCOUNT_READY);
        return;
      }
      setStep("done");
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
            // expo-router 57's Link pushes: swap screens instead of stacking them.
            dismissTo
            className="text-lg text-center text-general-200 mt-10"
          >
            Already have an account?{" "}
            <Text className="text-primary-500">Log In</Text>
          </Link>
        </View>

        <VerificationModal
          visible={step !== "form"}
          verified={step === "done"}
          email={form.email.trim()}
          code={code}
          error={codeError}
          verifying={busy}
          onChangeCode={setCode}
          onVerify={onPressVerify}
          onBrowseHome={() => router.replace("/(root)/(tabs)/home")}
        />
      </View>
    </ScrollView>
  );
};

export default SignUp;
