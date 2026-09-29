import { Image, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { images } from "@/constants";

/**
 * Chat with your driver is not built yet: it needs a driver app on the other
 * end (see docs/BUILD_PLAN.md §11). The tab says so honestly.
 */
const Chat = () => (
  <SafeAreaView className="flex-1 bg-white p-5">
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Text className="text-2xl font-JakartaBold">Chat List</Text>
      <View className="flex-1 flex justify-center items-center">
        <Image
          source={images.message}
          accessibilityLabel="No messages"
          className="w-full h-40"
          resizeMode="contain"
        />
        <Text className="text-3xl font-JakartaBold mt-3">
          No Messages, yet.
        </Text>
        <Text className="text-base font-Jakarta text-general-200 mt-2 text-center px-7">
          Chat with your driver is coming soon.
        </Text>
      </View>
    </ScrollView>
  </SafeAreaView>
);

export default Chat;
