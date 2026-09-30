import { View, Image } from "react-native";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";

import PopularPlaces from "@/components/PopularPlaces";
import { icons } from "@/constants";
import { GoogleInputProps } from "@/types/type";

// A style object takes a colour string, not a class: read the token itself.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require("../tailwind.config").theme.extend;

/**
 * The From/To address search (Google Places). Without a Places key the search
 * cannot run, so the rider picks a popular Zagreb place instead (W11).
 */
const GoogleTextInput = ({
  icon,
  initialLocation,
  containerStyle,
  textInputBackgroundColor,
  handlePress,
}: GoogleInputProps) => {
  const googlePlacesApiKey = process.env.EXPO_PUBLIC_PLACES_API_KEY;
  if (!googlePlacesApiKey) {
    return (
      <PopularPlaces
        icon={icon}
        initialLocation={initialLocation}
        containerStyle={containerStyle}
        handlePress={handlePress}
      />
    );
  }

  return (
    <View
      className={`flex flex-row items-center justify-center relative z-50 rounded-xl ${containerStyle}`}
    >
      <GooglePlacesAutocomplete
        fetchDetails={true}
        // The suggestions sit in a scroll view already (Find ride's sheet):
        // a second vertical scroller there is a nested-list error in React
        // Native 0.86, and five suggestions need no scrolling of their own.
        disableScroll
        placeholder="Search"
        debounce={200}
        styles={{
          textInputContainer: {
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 20,
            marginHorizontal: 20,
            position: "relative",
            shadowColor: colors.secondary["300"],
          },
          textInput: {
            backgroundColor: textInputBackgroundColor
              ? textInputBackgroundColor
              : "white",
            fontSize: 16,
            fontWeight: "600",
            marginTop: 5,
            width: "100%",
            borderRadius: 200,
          },
          listView: {
            backgroundColor: textInputBackgroundColor
              ? textInputBackgroundColor
              : "white",
            position: "relative",
            top: 0,
            width: "100%",
            borderRadius: 10,
            shadowColor: colors.secondary["300"],
            zIndex: 99,
          },
        }}
        onPress={(data, details = null) => {
          // No details (the lookup failed): nothing to book a trip with.
          if (!details) return;
          handlePress({
            latitude: details.geometry.location.lat,
            longitude: details.geometry.location.lng,
            address: data.description,
          });
        }}
        query={{
          key: googlePlacesApiKey,
          language: "en",
        }}
        renderLeftButton={() => (
          <View className="justify-center items-center w-6 h-6">
            <Image
              source={icon ? icon : icons.search}
              className="w-6 h-6"
              resizeMode="contain"
            />
          </View>
        )}
        textInputProps={{
          placeholderTextColor: "gray",
          placeholder: initialLocation ?? "Where do you want to go?",
        }}
      />
    </View>
  );
};

export default GoogleTextInput;
