import { useSSO } from "@clerk/expo";
import { router } from "expo-router";
import { Alert, Image, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { icons } from "@/constants";
import { googleOAuth } from "@/services/auth";

/**
 * "Log In with Google": lands on Home when it works, explains when it doesn't
 * (R10). Clerk's SSO flow (`useSSO`; `useOAuth` is deprecated in @clerk/expo 4.7).
 */
const OAuth = () => {
  const { startSSOFlow } = useSSO();

  const handleGoogleSignIn = async () => {
    const result = await googleOAuth(startSSOFlow);
    if (result.status === "signed-in") {
      router.replace("/(root)/(tabs)/home");
    } else if (result.status === "error") {
      Alert.alert("Google sign-in failed", result.message);
    }
  };

  return (
    <View>
      <View className="flex flex-row justify-center items-center mt-4 gap-x-3">
        <View className="flex-1 h-[1px] bg-general-100" />
        <Text className="text-lg">Or</Text>
        <View className="flex-1 h-[1px] bg-general-100" />
      </View>

      <CustomButton
        testID="oauth-google"
        title="Log In with Google"
        className="mt-5 w-full shadow-none"
        IconLeft={() => (
          <Image
            source={icons.google}
            resizeMode="contain"
            className="w-5 h-5 mx-2"
          />
        )}
        bgVariant="outline"
        textVariant="primary"
        onPress={handleGoogleSignIn}
      />
    </View>
  );
};

export default OAuth;
