import { TextInputProps, TouchableOpacityProps } from "react-native";

/** A row of GET /(api)/driver. NUMERIC columns arrive as strings. */
declare interface Driver {
  id: number;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
  car_image_url: string | null;
  car_seats: number;
  rating: string;
}

/** A driver on the booking map, priced for the current trip once quoted. */
declare interface MarkerData extends Driver {
  latitude: number;
  longitude: number;
  title: string;
  /** Minutes for this driver to reach the pickup (what the card and tracker show). */
  pickupMinutes: number;
}

/** A signed quote from POST /(api)/predict-price for one trip and time. */
declare interface TripQuote {
  token: string;
  fareCents: number;
  tripMinutes: number;
  surgeMultiplier: number;
  source: string;
  /** Epoch ms of the scheduled pickup, or null for a ride now. */
  scheduledAt: number | null;
  /** When the app received it (the server rejects tokens older than 10 min). */
  issuedAtMs: number;
}

/** A row of GET /(api)/rides (numeric columns are cast to float8 in SQL). */
declare interface Ride {
  ride_id: number;
  origin_address: string;
  destination_address: string;
  origin_latitude: number;
  origin_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  /** Trip minutes (pickup → destination). */
  ride_time: number;
  /** Driver → pickup minutes, stored at booking; null for rides booked before v1.1. */
  pickup_minutes: number | null;
  /** Euros. */
  fare_price: number;
  payment_status: "paid" | "refunded";
  created_at: string;
  /** When the payment succeeded: a ride booked for now departs at this instant. */
  paid_at: string | null;
  scheduled_at: string | null;
  cancelled_at: string | null;
  driver: {
    driver_id: number;
    first_name: string;
    last_name: string;
    profile_image_url: string | null;
    car_image_url: string | null;
    car_seats: number;
    rating: number;
  };
}

declare interface ButtonProps extends TouchableOpacityProps {
  title: string;
  bgVariant?:
    "primary" | "secondary" | "danger" | "outline" | "success" | "light";
  textVariant?: "primary" | "default" | "secondary" | "danger" | "success";
  IconLeft?: React.ComponentType<any>;
  IconRight?: React.ComponentType<any>;
  className?: string;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

declare interface GoogleInputProps {
  icon?: string;
  initialLocation?: string;
  containerStyle?: string;
  textInputBackgroundColor?: string;
  handlePress: ({
    latitude,
    longitude,
    address,
  }: {
    latitude: number;
    longitude: number;
    address: string;
  }) => void;
}

declare interface InputFieldProps extends TextInputProps {
  label: string;
  icon?: any;
  secureTextEntry?: boolean;
  labelStyle?: string;
  containerStyle?: string;
  inputStyle?: string;
  iconStyle?: string;
  className?: string;
}

declare interface Place {
  latitude: number;
  longitude: number;
  address: string;
}

declare interface LocationStore {
  userLatitude: number | null;
  userLongitude: number | null;
  userAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  destinationAddress: string | null;
  setUserLocation: (place: Place) => void;
  setDestinationLocation: (place: Place) => void;
  reset: () => void;
}

declare type LoadStatus = "idle" | "loading" | "ready" | "error";

declare interface DriverStore {
  drivers: MarkerData[];
  /** GET /(api)/driver: "error" is the confirm list's Q5, "ready" with no drivers its Q6. */
  driversStatus: LoadStatus;
  driversError: string | null;
  /** Bumped by `reloadDrivers()` to load the drivers again (Q5's Retry, a refocus after a failure). */
  driversRequest: number;
  quote: TripQuote | null;
  quoteStatus: LoadStatus;
  quoteError: string | null;
  /** Bumped by `requestQuote()` to ask for a fresh quote (Retry, stale price). */
  quoteRequest: number;
  selectedDriver: number | null;
  setDrivers: (drivers: MarkerData[]) => void;
  setDriversStatus: (status: LoadStatus, error?: string | null) => void;
  reloadDrivers: () => void;
  /** "loading" and "error" keep the previous quote; `quote` is read for "ready" and "idle" only (P3c). */
  setQuote: (
    status: LoadStatus,
    quote?: TripQuote | null,
    error?: string | null,
  ) => void;
  requestQuote: () => void;
  setSelectedDriver: (driverId: number) => void;
  clearSelectedDriver: () => void;
  reset: () => void;
}

declare interface BookingStore {
  /** Epoch ms of the chosen pickup slot, or null for "now". */
  scheduledAt: number | null;
  /** K6: set when the server refused the slot; Find ride shows it in the picker, then clears it. */
  slotNotice: string | null;
  setScheduledAt: (atMs: number | null) => void;
  /** K6: back to Now, with the notice Find ride opens the picker with. */
  expireSlot: (notice: string) => void;
  clearSlotNotice: () => void;
  reset: () => void;
}

declare interface DriverCardProps {
  item: MarkerData;
  selected: number | null;
  setSelected: () => void;
  /** The trip's signed fare, or null while it is being quoted. */
  fareCents: number | null;
  /** Hide per-driver pickup minutes (scheduled rides). */
  hidePickupTime?: boolean;
}
