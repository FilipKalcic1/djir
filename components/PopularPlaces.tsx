import { useState } from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";

import { icons } from "@/constants";
import { GoogleInputProps } from "@/types/type";

/** A place the rider can pick without address search: its name and where it is. */
export interface PopularPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** Well-known Zagreb destinations, with their real coordinates (WGS84). */
export const ZAGREB_PLACES: readonly PopularPlace[] = [
  {
    id: "trg-bana-jelacica",
    name: "Trg bana Jelačića",
    latitude: 45.8131,
    longitude: 15.9772,
  },
  {
    id: "airport",
    name: "Zagreb Airport (Franjo Tuđman)",
    latitude: 45.7431,
    longitude: 16.0689,
  },
  {
    id: "glavni-kolodvor",
    name: "Glavni kolodvor",
    latitude: 45.8047,
    longitude: 15.9783,
  },
  { id: "jarun", name: "Jarun", latitude: 45.783, longitude: 15.92 },
  { id: "maksimir", name: "Maksimir", latitude: 45.826, longitude: 16.019 },
  {
    id: "arena-zagreb",
    name: "Arena Zagreb",
    latitude: 45.7714,
    longitude: 15.9433,
  },
  { id: "bundek", name: "Bundek", latitude: 45.7857, longitude: 15.9885 },
];

/** The address a picked place is booked and shown with. */
export const placeAddress = (place: PopularPlace) =>
  place.name.includes("Zagreb") ? place.name : `${place.name}, Zagreb`;

export const PLACES_KEY_NOTE =
  "Search needs a Google Places key (EXPO_PUBLIC_PLACES_API_KEY) — pick a popular place.";

/** GoogleTextInput's props; `initialLocation` shows until a place is picked here. */
type PopularPlacesProps = Omit<GoogleInputProps, "textInputBackgroundColor">;

/**
 * The From/To field when the app has no Google Places key: address search
 * cannot run, so the rider picks from a short list of popular Zagreb places
 * instead of hitting a dead end, and a one-line note says what search needs.
 */
const PopularPlaces = ({
  icon,
  initialLocation,
  containerStyle = "",
  handlePress,
}: PopularPlacesProps) => {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = picked ?? initialLocation ?? null;

  return (
    <View
      testID="places-fallback"
      className={`relative z-50 rounded-xl ${containerStyle}`}
    >
      <TouchableOpacity
        testID="place-picker"
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={`${shown ?? "Where do you want to go?"}. Choose a place`}
        accessibilityState={{ expanded: open }}
        className="flex flex-row items-center px-5 py-4"
      >
        <Image
          source={icon ?? icons.search}
          className="w-6 h-6"
          resizeMode="contain"
        />
        <Text
          numberOfLines={1}
          className={`text-base font-JakartaSemiBold ml-4 flex-1 ${shown ? "text-black" : "text-general-200"}`}
        >
          {shown ?? "Where do you want to go?"}
        </Text>
        <Text className="text-base font-JakartaSemiBold text-primary-500">
          {open ? "Close" : "Choose"}
        </Text>
      </TouchableOpacity>
      <Text
        testID="places-key-note"
        className="text-xs font-Jakarta text-general-200 px-5 pb-3"
      >
        {PLACES_KEY_NOTE}
      </Text>
      {open && (
        <View testID="popular-places" className="px-5 pb-3">
          {ZAGREB_PLACES.map((place) => (
            <TouchableOpacity
              key={place.id}
              testID={`popular-place-${place.id}`}
              accessibilityRole="button"
              accessibilityLabel={place.name}
              onPress={() => {
                setPicked(place.name);
                setOpen(false);
                handlePress({
                  latitude: place.latitude,
                  longitude: place.longitude,
                  address: placeAddress(place),
                });
              }}
              className="py-3 border-b border-neutral-200"
            >
              <Text className="text-base font-JakartaMedium">{place.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

export default PopularPlaces;
