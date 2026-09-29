import { useEffect, useMemo, useRef } from "react";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";

import { icons } from "@/constants";
import { LatLng } from "@/lib/geo";
import { regionFor } from "@/lib/map";
import { useDriverStore, useLocationStore } from "@/store";

// A prop takes a colour string, not a class: read the token itself.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require("../tailwind.config").theme.extend;

const directionsApiKey = process.env.EXPO_PUBLIC_DIRECTIONS_API_KEY;

/**
 * The booking map: the rider, the nearby drivers and the route. It only reads
 * the stores — drivers are placed and quoted once, by useDriverQuotes — so
 * every screen shows the same drivers in the same places (R12). It re-frames
 * when the trip changes (R51). Without a location it frames Zagreb (R19).
 */
const Map = () => {
  const {
    userLatitude,
    userLongitude,
    destinationLatitude,
    destinationLongitude,
  } = useLocationStore();
  const { drivers, selectedDriver } = useDriverStore();
  const mapRef = useRef<MapView>(null);

  const pickup: LatLng | null =
    userLatitude !== null && userLongitude !== null
      ? { latitude: userLatitude, longitude: userLongitude }
      : null;
  const destination: LatLng | null =
    destinationLatitude !== null && destinationLongitude !== null
      ? { latitude: destinationLatitude, longitude: destinationLongitude }
      : null;

  const region = useMemo(
    () =>
      regionFor(
        destination && pickup
          ? [pickup, destination]
          : pickup
            ? [pickup, ...drivers]
            : [],
      ),
    // Re-frame for a new trip, not for every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      userLatitude,
      userLongitude,
      destinationLatitude,
      destinationLongitude,
      drivers.length,
    ],
  );

  useEffect(() => {
    mapRef.current?.animateToRegion(region, 500);
  }, [region]);

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      className="w-full h-full rounded-2xl"
      tintColor="black"
      mapType="mutedStandard"
      showsPointsOfInterest={false}
      initialRegion={region}
      showsUserLocation
      userInterfaceStyle="light"
    >
      {drivers.map((driver) => (
        <Marker
          key={driver.id}
          coordinate={{
            latitude: driver.latitude,
            longitude: driver.longitude,
          }}
          title={driver.title}
          image={
            selectedDriver === driver.id ? icons.selectedMarker : icons.marker
          }
        />
      ))}

      {destination && (
        <Marker
          key="destination"
          coordinate={destination}
          title="Destination"
          image={icons.pin}
        />
      )}
      {destination && pickup && directionsApiKey && (
        <MapViewDirections
          origin={pickup}
          destination={destination}
          apikey={directionsApiKey}
          strokeColor={colors.primary["500"]}
          strokeWidth={2}
        />
      )}
    </MapView>
  );
};

export default Map;
