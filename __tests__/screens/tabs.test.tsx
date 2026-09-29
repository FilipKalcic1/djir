/**
 * The four tabs render on React 19 / React Native 0.86 with nothing set up
 * (no Places key, no rides yet), and Home's destination field is not a dead
 * end without a Places key: a popular place starts a trip on Find ride (W11).
 * History, the banner and the map have their own tests; here they are the
 * real list with an empty history and a plain map.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import Chat from "@/app/(root)/(tabs)/chat";
import Home from "@/app/(root)/(tabs)/home";
import Profile from "@/app/(root)/(tabs)/profile";
import Rides from "@/app/(root)/(tabs)/rides";
import { useBookingStore, useLocationStore } from "@/store";

import { resetClerk } from "../helpers/mocks/clerk";
import { resetRouter, router } from "../helpers/mocks/expo-router";

jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));
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
