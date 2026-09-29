/**
 * The Find ride screen (WP4 Surfaces "When row", K4–K6, K10), on fixed Zagreb
 * clocks and the real stores and picker. The layout, the Places inputs and
 * react-native-modal are replaced by plain views, so what the rider sees on
 * this screen is what is under test.
 */
import { Ionicons } from "@expo/vector-icons";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import tailwindColors from "tailwindcss/colors";

import FindRide from "@/app/(root)/find-ride";
import { setServerTime } from "@/services/clock";
import {
  SLOT_EXPIRED_NOTICE,
  useBookingStore,
  useDriverStore,
  useLocationStore,
} from "@/store";

import { resetRouter, router } from "../helpers/mocks/expo-router";
import { MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@/components/RideLayout", () =>
  require("../helpers/mocks/ride-layout"),
);
jest.mock("@/components/GoogleTextInput", () => {
  const { View } = jest.requireActual("react-native");
  return function MockGoogleTextInput() {
    return <View />;
  };
});
jest.mock("react-native-modal", () =>
  require("../helpers/mocks/react-native-modal"),
);

const NOW = Date.parse("2026-09-29T06:05:00.000Z"); // Tue 29 Sep, 08:05 CEST
const slotAt = (iso: string) => Date.parse(iso);
const slotId = (iso: string) => `schedule-slot-${iso}`;

const whenRow = () => screen.getByTestId("when-field");
/** The When row's time (the row also holds the icon's glyph and "Change"). */
const whenLabel = (text: string) => within(whenRow()).getByText(text);
const findDrivers = () => fireEvent.press(screen.getByText(/^Find /));

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  setServerTime(new Date(NOW).toISOString(), NOW); // no skew unless a test says so
  resetRouter();
  useLocationStore.setState({
    userLatitude: 45.8,
    userLongitude: 15.945,
    userAddress: "Tresnjevka, Zagreb",
    destinationLatitude: 45.8131,
    destinationLongitude: 15.9772,
    destinationAddress: "Trg bana Jelačića, Zagreb",
  });
  useDriverStore.getState().reset();
  useBookingStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("find-ride — the When row", () => {
  it("W1 C4: the When row (when-field) is bg-neutral-100 rounded-xl with the time-outline icon, under the label 'When'", () => {
    render(<FindRide />);

    expect(screen.getByText("When")).toBeOnTheScreen();
    expect(whenRow()).toHaveStyle({
      backgroundColor: tailwindColors.neutral["100"],
      borderTopLeftRadius: 12,
      borderBottomRightRadius: 12,
    });
    expect(within(whenRow()).UNSAFE_getByType(Ionicons).props.name).toBe(
      "time-outline",
    );
    expect(whenLabel("Now")).toBeOnTheScreen();
    expect(whenRow()).toHaveProp(
      "accessibilityLabel",
      "Pickup time: Now. Change",
    );
    expect(screen.getByText("Change")).toHaveStyle({
      color: colors.primary["500"],
    });
  });

  it("W1 C4: a chosen slot reads 'Tomorrow · 08:00' on the When row, and the button 'Find drivers'", () => {
    useBookingStore.setState({
      scheduledAt: slotAt("2026-09-30T06:00:00.000Z"),
    });

    render(<FindRide />);

    expect(whenLabel("Tomorrow · 08:00")).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Find drivers" }),
    ).toBeOnTheScreen();
  });

  it("tapping the When row opens the picker with no notice; setting a time closes it and shows the time", () => {
    render(<FindRide />);

    fireEvent.press(whenRow());
    expect(screen.getByTestId("schedule-modal")).toBeOnTheScreen();
    expect(screen.queryByTestId("schedule-modal-notice")).toBeNull();
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-30"));
    fireEvent.press(screen.getByTestId(slotId("2026-09-30T06:00:00.000Z")));
    fireEvent.press(screen.getByTestId("schedule-confirm"));

    expect(screen.queryByTestId("schedule-modal")).toBeNull();
    expect(useBookingStore.getState().scheduledAt).toBe(
      slotAt("2026-09-30T06:00:00.000Z"),
    );
    expect(whenLabel("Tomorrow · 08:00")).toBeOnTheScreen();
  });

  it("K10: a re-render of Find ride while the picker is open keeps the rider's choice", () => {
    render(<FindRide />);
    fireEvent.press(whenRow());
    fireEvent.press(screen.getByTestId("schedule-day-2026-10-01"));

    act(() => jest.advanceTimersByTime(MIN));
    act(() =>
      useLocationStore.setState({ userAddress: "Trešnjevka sjever, Zagreb" }),
    );

    expect(screen.getByTestId("schedule-day-2026-10-01")).toBeChecked();
    expect(screen.getByTestId("schedule-chip-now")).not.toBeChecked();
  });
});

describe("find-ride — K4/K5: the chosen time went stale before Find drivers", () => {
  it("K4 W9: a slot that passed less than 15 min ago moves to the earliest one; Find ride stays, shows the notice and the new time, and the next tap goes on", () => {
    // 08:30 fell inside the 30-min lead at 08:00; it is 08:05 now.
    useBookingStore.setState({
      scheduledAt: slotAt("2026-09-29T06:30:00.000Z"),
    });
    render(<FindRide />);

    findDrivers();

    const notice = screen.getByTestId("schedule-notice");
    expect(notice).toHaveTextContent(
      "That time is now too soon — moved to 08:45",
    );
    expect(notice).toHaveStyle({ color: colors.warning["700"] });
    // A screen reader hears the moved time without leaving the button.
    expect(notice).toHaveProp("accessibilityLiveRegion", "polite");
    expect(whenLabel("Today · 08:45")).toBeOnTheScreen();
    expect(useBookingStore.getState().scheduledAt).toBe(
      slotAt("2026-09-29T06:45:00.000Z"),
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByTestId("schedule-modal")).toBeNull();

    findDrivers();

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/(root)/confirm-ride");
    expect(screen.queryByTestId("schedule-notice")).toBeNull();
  });

  it("K5: a slot that passed 15 min ago or more resets to Now and opens the picker with the notice inside it", () => {
    // 08:15 fell inside the lead at 07:45; it is 08:05 now.
    useBookingStore.setState({
      scheduledAt: slotAt("2026-09-29T06:15:00.000Z"),
    });
    render(<FindRide />);

    findDrivers();

    const modal = screen.getByTestId("schedule-modal");
    expect(
      within(modal).getByTestId("schedule-modal-notice"),
    ).toHaveTextContent(
      "That pickup time is no longer available — choose a new time",
    );
    // The rider was scheduling: the earliest slot is chosen, not Now.
    expect(
      within(modal).getByTestId(slotId("2026-09-29T06:45:00.000Z")),
    ).toBeChecked();
    expect(within(modal).getByTestId("schedule-chip-now")).not.toBeChecked();
    expect(useBookingStore.getState().scheduledAt).toBeNull();
    expect(screen.queryByTestId("schedule-notice")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("K4 K5: the check uses the server's clock — a device 20 min slow still moves the slot", () => {
    setServerTime(new Date(NOW).toISOString(), NOW - 20 * MIN);
    useBookingStore.setState({
      scheduledAt: slotAt("2026-09-29T06:45:00.000Z"),
    });
    render(<FindRide />);

    findDrivers(); // server 08:25: 08:45 fell inside the lead 10 min ago

    expect(screen.getByTestId("schedule-notice")).toHaveTextContent(
      "That time is now too soon — moved to 09:00",
    );
  });

  it("a ride now goes straight to the confirm list", () => {
    render(<FindRide />);

    findDrivers();

    expect(router.push).toHaveBeenCalledWith("/(root)/confirm-ride");
  });

  it("without both places it asks 'Where to?' and goes nowhere", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    useLocationStore.setState({ destinationAddress: null });
    render(<FindRide />);

    findDrivers();

    expect(alert).toHaveBeenCalledWith(
      "Where to?",
      "Choose both a pickup and a destination.",
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("find-ride — K4/K5 on Set pickup time: a picker left open a while", () => {
  const openAndChooseTheEarliest = () => {
    fireEvent.press(whenRow()); // 08:05: the earliest slot is 08:45
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-29"));
    fireEvent.press(screen.getByTestId(slotId("2026-09-29T06:45:00.000Z")));
  };

  it("K4: a slot that became too soon while the picker was open moves to the earliest one on Set pickup time, with the notice", () => {
    render(<FindRide />);
    openAndChooseTheEarliest();
    act(() => jest.advanceTimersByTime(20 * MIN)); // 08:25: 08:45 is 20 min away

    fireEvent.press(screen.getByTestId("schedule-confirm"));

    expect(screen.queryByTestId("schedule-modal")).toBeNull();
    expect(useBookingStore.getState().scheduledAt).toBe(
      slotAt("2026-09-29T07:00:00.000Z"),
    );
    expect(whenLabel("Today · 09:00")).toBeOnTheScreen();
    expect(screen.getByTestId("schedule-notice")).toHaveTextContent(
      "That time is now too soon — moved to 09:00",
    );
  });

  it("K5: a slot that went stale 15 min or more before Set pickup time reopens a fresh picker with the notice and the new earliest slot", () => {
    render(<FindRide />);
    openAndChooseTheEarliest();
    act(() => jest.advanceTimersByTime(35 * MIN)); // 08:40: the earliest is now 09:15

    fireEvent.press(screen.getByTestId("schedule-confirm"));

    const modal = screen.getByTestId("schedule-modal");
    expect(
      within(modal).getByTestId("schedule-modal-notice"),
    ).toHaveTextContent(SLOT_EXPIRED_NOTICE);
    expect(
      within(modal).queryByTestId(slotId("2026-09-29T06:45:00.000Z")),
    ).toBeNull();
    expect(
      within(modal).getByTestId(slotId("2026-09-29T07:15:00.000Z")),
    ).toBeChecked();
    expect(useBookingStore.getState().scheduledAt).toBeNull();
    expect(whenLabel("Now")).toBeOnTheScreen();
  });

  it("K10: a slot still on offer at Set pickup time is set as chosen, with no notice", () => {
    render(<FindRide />);
    openAndChooseTheEarliest();
    act(() => jest.advanceTimersByTime(5 * MIN)); // 08:10: 08:45 is still bookable

    fireEvent.press(screen.getByTestId("schedule-confirm"));

    expect(screen.queryByTestId("schedule-modal")).toBeNull();
    expect(useBookingStore.getState().scheduledAt).toBe(
      slotAt("2026-09-29T06:45:00.000Z"),
    );
    expect(screen.queryByTestId("schedule-notice")).toBeNull();
  });
});

describe("find-ride — K6: the server refused the slot", () => {
  it("K6: coming back with a slot notice opens the picker with the notice inside it, and clears the notice", () => {
    act(() => useBookingStore.getState().expireSlot(SLOT_EXPIRED_NOTICE));

    render(<FindRide />);

    expect(
      within(screen.getByTestId("schedule-modal")).getByTestId(
        "schedule-modal-notice",
      ),
    ).toHaveTextContent(
      "That pickup time is no longer available — choose a new time",
    );
    expect(useBookingStore.getState().slotNotice).toBeNull();
    expect(whenLabel("Now")).toBeOnTheScreen();
    expect(
      screen.getByTestId(slotId("2026-09-29T06:45:00.000Z")),
    ).toBeChecked();
    expect(screen.getByTestId("schedule-confirm")).toHaveTextContent(
      "Set pickup time",
    );
  });

  it("K6: a notice arriving while Find ride is showing opens the picker too", () => {
    render(<FindRide />);
    expect(screen.queryByTestId("schedule-modal")).toBeNull();

    act(() => useBookingStore.getState().expireSlot(SLOT_EXPIRED_NOTICE));

    expect(screen.getByTestId("schedule-modal-notice")).toHaveTextContent(
      SLOT_EXPIRED_NOTICE,
    );
    expect(useBookingStore.getState().slotNotice).toBeNull();
  });

  it("K6: closing the picker takes its notice with it; the When row opens it again without one", () => {
    act(() => useBookingStore.getState().expireSlot(SLOT_EXPIRED_NOTICE));
    render(<FindRide />);

    fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("schedule-modal")).toBeNull();
    fireEvent.press(whenRow());

    expect(screen.getByTestId("schedule-modal")).toBeOnTheScreen();
    expect(screen.queryByTestId("schedule-modal-notice")).toBeNull();
  });
});
