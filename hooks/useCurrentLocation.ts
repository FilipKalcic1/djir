import * as Location from "expo-location";
import { useEffect, useState } from "react";

import { useLocationStore } from "@/store";

export type LocationStatus = "locating" | "ready" | "denied" | "unavailable";

/**
 * Find the rider once and store it as the pickup. A denied permission or a
 * failed lookup is reported (the map then frames Zagreb and the rider types
 * the pickup) — never an endless spinner (R19). A failed reverse geocode still
 * gives a usable pickup.
 */
export function useCurrentLocation(): LocationStatus {
  const setUserLocation = useLocationStore((s) => s.setUserLocation);
  const known = useLocationStore((s) => s.userLatitude !== null);
  const [status, setStatus] = useState<LocationStatus>("locating");

  useEffect(() => {
    if (known) return;
    let cancelled = false;
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          if (!cancelled) setStatus("denied");
          return;
        }
        const { coords } = await Location.getCurrentPositionAsync({});
        let address = "Current location";
        try {
          const [place] = await Location.reverseGeocodeAsync(coords);
          const label = [place?.name, place?.city ?? place?.region]
            .filter(Boolean)
            .join(", ");
          if (label) address = label;
        } catch {
          // Keep the generic label: the coordinates are what the pickup needs.
        }
        if (!cancelled) {
          setUserLocation({
            latitude: coords.latitude,
            longitude: coords.longitude,
            address,
          });
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [known, setUserLocation]);

  return known ? "ready" : status;
}
