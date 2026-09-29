import { useEffect, useRef } from "react";

import { useFetch } from "@/hooks/useFetch";
import { generateMarkersFromData } from "@/lib/map";
import { apiErrorCode, LOAD_TIMEOUT_MS } from "@/services/api";
import { fetchQuote } from "@/services/quotes";
import {
  SLOT_EXPIRED_NOTICE,
  useBookingStore,
  useDriverStore,
  useLocationStore,
} from "@/store";
import { Driver } from "@/types/type";

/**
 * The single owner of booking data (mounted once, in the (root) layout):
 * places the drivers around the pickup and keeps one signed quote for the
 * current trip and pickup time. Maps and screens only read the store, so a
 * driver never moves or re-prices between screens (R12). The latest request
 * wins; an older response is dropped (R18). A slot the server refuses sends
 * the rider back to the picker (K6). How the drivers loaded is in the store
 * too, and `reloadDrivers()` loads them again (Q5, Q6).
 */
export function useDriverQuotes() {
  const {
    userLatitude,
    userLongitude,
    destinationLatitude,
    destinationLongitude,
  } = useLocationStore();
  const scheduledAt = useBookingStore((s) => s.scheduledAt);
  const expireSlot = useBookingStore((s) => s.expireSlot);
  const setDrivers = useDriverStore((s) => s.setDrivers);
  const setDriversStatus = useDriverStore((s) => s.setDriversStatus);
  const driversRequest = useDriverStore((s) => s.driversRequest);
  const setQuote = useDriverStore((s) => s.setQuote);
  const quoteRequest = useDriverStore((s) => s.quoteRequest);
  const {
    data: drivers,
    loading: driversLoading,
    error: driversError,
    refetch: loadDrivers,
  } = useFetch<Driver[]>("/(api)/driver", { timeoutMs: LOAD_TIMEOUT_MS });

  // Q5/Q6: the confirm list says when the drivers failed to load, or none exist.
  useEffect(() => {
    setDriversStatus(
      driversLoading ? "loading" : driversError ? "error" : "ready",
      driversError,
    );
  }, [driversLoading, driversError, setDriversStatus]);

  // Q5: Retry (or the confirm list regaining focus after a failure) asks again.
  const answeredRequest = useRef(driversRequest);
  useEffect(() => {
    if (driversRequest === answeredRequest.current) return;
    answeredRequest.current = driversRequest;
    loadDrivers();
  }, [driversRequest, loadDrivers]);

  useEffect(() => {
    if (!drivers || userLatitude === null || userLongitude === null) return;
    setDrivers(
      generateMarkersFromData({
        data: drivers,
        pickup: { latitude: userLatitude, longitude: userLongitude },
      }),
    );
  }, [drivers, userLatitude, userLongitude, setDrivers]);

  useEffect(() => {
    if (
      userLatitude === null ||
      userLongitude === null ||
      destinationLatitude === null ||
      destinationLongitude === null
    ) {
      setQuote("idle");
      return;
    }
    const controller = new AbortController();
    setQuote("loading");
    fetchQuote(
      { latitude: userLatitude, longitude: userLongitude },
      { latitude: destinationLatitude, longitude: destinationLongitude },
      scheduledAt,
      controller.signal,
    )
      .then((quote) => {
        if (!controller.signal.aborted) setQuote("ready", quote);
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        // The error lands first, so a Payment waiting for this quote (P3c)
        // stops waiting before the slot resets and a ride-now quote arrives.
        setQuote("error", null, error.message);
        if (apiErrorCode(error) === "slot_unavailable") {
          expireSlot(SLOT_EXPIRED_NOTICE); // K6
        }
      });
    return () => controller.abort();
  }, [
    userLatitude,
    userLongitude,
    destinationLatitude,
    destinationLongitude,
    scheduledAt,
    quoteRequest,
    setQuote,
    expireSlot,
  ]);
}
