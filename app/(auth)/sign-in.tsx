import { useSignIn } from "@clerk/expo/legacy";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, Image, ScrollView, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import OAuth from "@/components/OAuth";
import { icons, images } from "@/constants";
import { clerkErrorMessage } from "@/lib/utils";
import { activateSession } from "@/services/auth";

/** A sign-in that completed, but whose session could not be made active. */
type Unactivated = { identifier: string; session: string | null };

const SignIn = () => {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [form, setForm] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  // Clerk holds that session for this phone and would refuse a second
  // sign-in, so Sign In for the same email retries only the activation.
  const [unactivated, setUnactivated] = useState<Unactivated | null>(null);

  const onSignInPress = async () => {
    if (!isLoaded) return;
    setSubmitting(true);
    const identifier = form.email.trim();
    try {
      let session: string | null;
      if (unactivated?.identifier === identifier) {
        session = unactivated.session;
      } else {
        const attempt = await signIn.create({
          identifier,
          password: form.password,
        });
        if (attempt.status !== "complete") {
          Alert.alert("Sign in", "Log in failed. Please try again.");
          return;
        }
        session = attempt.createdSessionId;
      }
      try {
        await activateSession(setActive, session);
      } catch (err) {
        setUnactivated({ identifier, session });
        throw err;
      }
      router.replace("/(root)/(tabs)/home");
    } catch (err) {
      Alert.alert(
        "Sign in",
        clerkErrorMessage(err, "Log in failed. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-white" keyboardShouldPersistTaps="handled">
      <View className="flex-1 bg-white">
        <View className="relative w-full h-[250px]">
          <Image source={images.signUpCar} className="z-0 w-full h-[250px]" />
          <Text className="text-2xl text-black font-JakartaSemiBold absolute bottom-5 left-5">
            Welcome 👋
          </Text>
        </View>

        <View className="p-5">
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
            title="Sign In"
            onPress={onSignInPress}
            loading={submitting}
            className="mt-6"
          />
          <OAuth />
          <Link
            href="/sign-up"
            // expo-router 57's Link pushes: swap screens instead of stacking them.
            dismissTo
            className="text-lg text-center text-general-200 mt-10"
          >
            Don't have an account?{" "}
            <Text className="text-primary-500">Sign Up</Text>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
};

export default SignIn;
