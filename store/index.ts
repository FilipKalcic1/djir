import { create } from "zustand";

import {
  BookingStore,
  DriverStore,
  LocationStore,
  MarkerData,
  TripQuote,
} from "@/types/type";

const initialLocation = {
  userLatitude: null,
  userLongitude: null,
  userAddress: null,
  destinationLatitude: null,
  destinationLongitude: null,
  destinationAddress: null,
};

export const useLocationStore = create<LocationStore>((set) => ({
  ...initialLocation,
  setUserLocation: ({ latitude, longitude, address }) => {
    set({
      userLatitude: latitude,
      userLongitude: longitude,
      userAddress: address,
    });
    useDriverStore.getState().clearSelectedDriver();
  },
  setDestinationLocation: ({ latitude, longitude, address }) => {
    set({
      destinationLatitude: latitude,
      destinationLongitude: longitude,
      destinationAddress: address,
    });
    useDriverStore.getState().clearSelectedDriver();
  },
  reset: () => set(initialLocation),
}));

const initialDrivers = {
  drivers: [] as MarkerData[],
  driversStatus: "idle" as const,
  driversError: null,
  driversRequest: 0,
  quote: null as TripQuote | null,
  quoteStatus: "idle" as const,
  quoteError: null,
  quoteRequest: 0,
  selectedDriver: null,
};

export const useDriverStore = create<DriverStore>((set) => ({
  ...initialDrivers,
  setDrivers: (drivers) => set({ drivers }),
  // The drivers already placed stay while a reload runs or fails (Q5).
  setDriversStatus: (driversStatus, driversError = null) =>
    set({ driversStatus, driversError }),
  reloadDrivers: () => set((s) => ({ driversRequest: s.driversRequest + 1 })),
  // While a new quote loads, and when it fails, the previous one is kept
  // (screens show the loading or error state, and the confirm list prices
  // nothing unless the status is "ready"), so a payment in progress is never
  // unmounted by a refresh (P3c).
  setQuote: (quoteStatus, quote = null, quoteError = null) =>
    set(
      quoteStatus === "loading" || quoteStatus === "error"
        ? { quoteStatus, quoteError }
        : { quoteStatus, quote, quoteError },
    ),
  requestQuote: () => set((s) => ({ quoteRequest: s.quoteRequest + 1 })),
  setSelectedDriver: (driverId) => set({ selectedDriver: driverId }),
  clearSelectedDriver: () => set({ selectedDriver: null }),
  reset: () => set(initialDrivers),
}));

/** K5/K6: why the picker opens by itself (lib/schedule's K5 copy). */
export const SLOT_EXPIRED_NOTICE =
  "That pickup time is no longer available — choose a new time";

const initialBooking = { scheduledAt: null, slotNotice: null };

export const useBookingStore = create<BookingStore>((set) => ({
  ...initialBooking,
  // A time the rider (or Home's "start as Now") chose makes any K6 notice moot.
  setScheduledAt: (scheduledAt) => {
    set({ scheduledAt, slotNotice: null });
    useDriverStore.getState().clearSelectedDriver();
  },
  // K6: the server refused the slot. Back to Now; Find ride opens the picker
  // with the notice, and the confirm list and Book Ride go back to it.
  expireSlot: (notice) => {
    set({ scheduledAt: null, slotNotice: notice });
    useDriverStore.getState().clearSelectedDriver();
  },
  clearSlotNotice: () => set({ slotNotice: null }),
  reset: () => set(initialBooking),
}));

/** After a booking: start the next one from a clean slate (keep "where I am"). */
export function resetBookingFlow() {
  const { userLatitude, userLongitude, userAddress } =
    useLocationStore.getState();
  useLocationStore.getState().reset();
  useLocationStore.setState({ userLatitude, userLongitude, userAddress });
  useDriverStore.getState().clearSelectedDriver();
  useDriverStore.getState().setQuote("idle"); // the booked trip's signed quote
  useBookingStore.getState().reset();
}

/** On sign-out: forget everything about the previous user (R52). */
export function resetSession() {
  useLocationStore.getState().reset();
  useDriverStore.getState().reset();
  useBookingStore.getState().reset();
}
