import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import { onboarding } from "@/constants";

type Slide = (typeof onboarding)[number];

const toSignUp = () => router.replace("/(auth)/sign-up");

/**
 * Onboarding: three slides in a horizontal, paging FlatList, with dots and
 * Next / Get Started. (react-native-swiper, used before, reads ViewPropTypes,
 * which React Native 0.86 removed: the screen crashed on launch.)
 */
const Welcome = () => {
  const pager = useRef<FlatList<Slide>>(null);
  const { width: windowWidth } = useWindowDimensions();
  // The pager's own width once laid out; the window's until then.
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const [activeIndex, setActiveIndex] = useState(0);

  const isLastSlide = activeIndex === onboarding.length - 1;

  const next = () => {
    const index = activeIndex + 1;
    pager.current?.scrollToOffset({
      offset: index * pageWidth,
      animated: true,
    });
    setActiveIndex(index);
  };

  /** A swipe settled on a page. */
  const onSwipe = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    setActiveIndex(Math.min(Math.max(page, 0), onboarding.length - 1));
  };

  return (
    <SafeAreaView className="flex h-full items-center justify-between bg-white">
      <TouchableOpacity
        onPress={toSignUp}
        accessibilityRole="button"
        accessibilityLabel="Skip"
        className="w-full flex justify-end items-end p-5"
      >
        <Text className="text-black text-base font-JakartaBold">Skip</Text>
      </TouchableOpacity>

      <FlatList
        testID="onboarding-pager"
        ref={pager}
        data={onboarding}
        keyExtractor={(item) => String(item.id)}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onLayout={({ nativeEvent }) => {
          if (nativeEvent.layout.width > 0)
            setPageWidth(nativeEvent.layout.width);
        }}
        onMomentumScrollEnd={onSwipe}
        getItemLayout={(_, index) => ({
          length: pageWidth,
          offset: pageWidth * index,
          index,
        })}
        className="w-full flex-1"
        renderItem={({ item }) => (
          <View
            testID={`onboarding-slide-${item.id}`}
            style={{ width: pageWidth }}
            className="flex items-center justify-center p-5"
          >
            <Image
              source={item.image}
              className="w-full h-[300px]"
              resizeMode="contain"
            />
            <View className="flex flex-row items-center justify-center w-full mt-10">
              <Text className="text-black text-3xl font-bold mx-10 text-center">
                {item.title}
              </Text>
            </View>
            <Text className="text-base font-JakartaSemiBold text-center text-general-200 mx-10 mt-3">
              {item.description}
            </Text>
          </View>
        )}
      />

      <View
        testID="onboarding-dots"
        accessibilityLabel={`Page ${activeIndex + 1} of ${onboarding.length}`}
        className="flex flex-row justify-center items-center mt-5"
      >
        {onboarding.map((item, index) => (
          <View
            key={item.id}
            testID={`onboarding-dot-${index}`}
            className={`w-[32px] h-[4px] mx-1 rounded-full ${index === activeIndex ? "bg-primary-500" : "bg-slate-200"}`}
          />
        ))}
      </View>

      <CustomButton
        title={isLastSlide ? "Get Started" : "Next"}
        onPress={isLastSlide ? toSignUp : next}
        className="w-11/12 mt-10 mb-5"
      />
    </SafeAreaView>
  );
};

export default Welcome;
