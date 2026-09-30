import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";

/**
 * What the root shows when Clerk, the sign-in service, can't be reached as
 * the app starts: no network, or none behind the Wi-Fi (EG8). **Retry**
 * loads it again, and stays busy while it does.
 */
const ClerkUnreachable = ({
  retrying = false,
  onRetry,
}: {
  retrying?: boolean;
  onRetry?: () => void;
}) => (
  <View
    testID="clerk-unreachable"
    className="flex-1 bg-white items-center justify-center px-8"
  >
    <Text
      accessibilityRole="header"
      className="text-2xl font-JakartaBold text-black text-center"
    >
      Can't connect
    </Text>
    <Text className="text-base font-JakartaMedium text-secondary-700 text-center mt-2">
      Djir couldn't reach its sign-in service. Check your internet connection
      and try again.
    </Text>
    <CustomButton
      testID="clerk-retry"
      title="Retry"
      className="mt-8"
      loading={retrying}
      onPress={onRetry}
    />
  </View>
);

export default ClerkUnreachable;
