/**
 * The four tabs render on React 19 / React Native 0.86 with nothing set up
 * (no Places key, no rides yet), and Home's destination field is not a dead
 * end without a Places key: a popular place starts a trip on Find ride (W11).
 * Home's Sign out forgets the rider's trip and reminders even when Clerk's
 * own sign-out request fails (R52, N4). History, the banner and the map have
 * their own tests; here they are the real list with an empty history and a
 * plain map.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import Chat from "@/app/(root)/(tabs)/chat";
import Home from "@/app/(root)/(tabs)/home";
import Profile from "@/app/(root)/(tabs)/profile";
import Rides from "@/app/(root)/(tabs)/rides";
import { cancelAllReminders } from "@/services/reminders";
import { useBookingStore, useDriverStore, useLocationStore } from "@/store";

import { auth, resetClerk } from "../helpers/mocks/clerk";
import { resetRouter, router } from "../helpers/mocks/expo-router";

jest.mock("@clerk/expo", () => require("../helpers/mocks/clerk"));
jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@/components/Map", () => require("../helpers/mocks/booking-map"));
jest.mock("@/hooks/useCurrentLocation", () => ({
  useCurrentLocation: () => "ready",
}));
jest.mock("@/services/reminders", () => ({
  cancelAllReminders: jest.fn(async () => {}),
}));
/** An empty history that has finished loading. */
const mockHistory = {
  rides: [],
  loading: false,
  error: null,
  refetch: jest.fn(),
  nowMs: Date.parse("2026-10-03T06:00:00.000Z"),
};
jest.mock("@/hooks/useRides", () => ({
  SPEEDUP: 1,
  useRides: () => mockHistory,
}));

const savedKey = process.env.EXPO_PUBLIC_PLACES_API_KEY;

beforeEach(() => {
  resetClerk();
  resetRouter();
  process.env.EXPO_PUBLIC_PLACES_API_KEY = "";
  useLocationStore.setState({
    destinationLatitude: null,
    destinationLongitude: null,
    destinationAddress: null,
  });
  useBookingStore.getState().reset();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.EXPO_PUBLIC_PLACES_API_KEY;
  else process.env.EXPO_PUBLIC_PLACES_API_KEY = savedKey;
});

describe("the tabs render with nothing set up", () => {
  it("Home greets the rider, shows the map and an empty history", () => {
    render(<Home />);

    expect(screen.getByText("Welcome Ana 👋")).toBeOnTheScreen();
    expect(screen.getByTestId("booking-map")).toBeOnTheScreen();
    expect(screen.getByTestId("rides-empty")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeOnTheScreen();
  });

  it("Rides lists nothing yet", () => {
    render(<Rides />);

    expect(screen.getByText("All Rides")).toBeOnTheScreen();
    expect(screen.getByTestId("rides-empty")).toHaveTextContent("No rides yet");
  });

  it("Chat says chat with the driver is coming", () => {
    render(<Chat />);

    expect(screen.getByText("No Messages, yet.")).toBeOnTheScreen();
    expect(
      screen.getByText("Chat with your driver is coming soon."),
    ).toBeOnTheScreen();
  });

  it("Profile shows the rider's name", () => {
    render(<Profile />);

    expect(screen.getByText("My profile")).toBeOnTheScreen();
    expect(screen.getByPlaceholderText("Ana")).toBeOnTheScreen();
  });
});

describe("Home without a Places key (W11)", () => {
  it("W11: the destination field offers popular places; a pick sets the destination, starts as Now and opens Find ride", () => {
    useBookingStore.setState({
      scheduledAt: Date.parse("2026-10-04T06:00:00.000Z"),
    });
    render(<Home />);
    expect(screen.getByTestId("places-key-note")).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId("place-picker"));
    act(() => {
      fireEvent.press(screen.getByTestId("popular-place-arena-zagreb"));
    });

    expect(useLocationStore.getState()).toMatchObject({
      destinationLatitude: 45.7714,
      destinationLongitude: 15.9433,
      destinationAddress: "Arena Zagreb",
    });
    expect(useBookingStore.getState().scheduledAt).toBeNull();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/(root)/find-ride");
  });
});

describe("Home's Sign out (R52, N4)", () => {
  const TOMORROW_8AM = Date.parse("2026-10-04T06:00:00.000Z");

  /** The trip the rider was planning: a pickup time, a destination, a driver. */
  const planTrip = () => {
    useBookingStore.getState().setScheduledAt(TOMORROW_8AM);
    useLocationStore.getState().setDestinationLocation({
      latitude: 45.8131,
      longitude: 15.9772,
      address: "Trg bana Jelačića",
    });
    useDriverStore.getState().setSelectedDriver(2);
  };
  const trip = () => ({
    destinationAddress: useLocationStore.getState().destinationAddress,
    selectedDriver: useDriverStore.getState().selectedDriver,
    scheduledAt: useBookingStore.getState().scheduledAt,
  });
  const NO_TRIP = {
    destinationAddress: null,
    selectedDriver: null,
    scheduledAt: null,
  };

  async function signOutOfHome() {
    planTrip();
    render(<Home />);
    expect(trip()).toEqual({
      destinationAddress: "Trg bana Jelačića",
      selectedDriver: 2,
      scheduledAt: TOMORROW_8AM,
    });
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    });
  }

  beforeEach(() => {
    jest.mocked(cancelAllReminders).mockClear();
    useDriverStore.getState().reset();
  });

  it("R52 N4: signs the rider out, forgets their trip, cancels every ride reminder and opens sign-in", async () => {
    await signOutOfHome();

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(trip()).toEqual(NO_TRIP);
    expect(cancelAllReminders).toHaveBeenCalledTimes(1);
    expect(jest.mocked(router.replace).mock.calls).toEqual([
      ["/(auth)/sign-in"],
    ]);
  });

  it("R52 N4: offline — Clerk 6 signs the phone out, then rethrows its failed request to the server — the trip is still forgotten, the reminders cancelled and sign-in opened", async () => {
    auth.signOut.mockRejectedValueOnce(
      new Error(
        'ClerkJS: Network error at "https://clever-cat-12.clerk.accounts.dev/v1/client/sessions?__clerk_api_version=2026-05-12&_clerk_js_version=6.35.0&_method=DELETE&_is_native=1" - TypeError: Network request failed. Please try again.',
      ),
    );

    await signOutOfHome();

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(trip()).toEqual(NO_TRIP);
    expect(cancelAllReminders).toHaveBeenCalledTimes(1);
    expect(jest.mocked(router.replace).mock.calls).toEqual([
      ["/(auth)/sign-in"],
    ]);
  });
});
