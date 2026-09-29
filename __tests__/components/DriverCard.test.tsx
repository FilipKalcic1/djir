/**
 * One driver on the confirm list: the real rating (R45), the signed fare, the
 * pickup minutes the tracker will count down from (R14), and the radio
 * semantics of a selectable card (R74).
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { Image } from "react-native";
import palette from "tailwindcss/colors";

import DriverCard from "@/components/DriverCard";
import { icons } from "@/constants";
import { generateMarkersFromData } from "@/lib/map";
import { phaseAt, timelineFor, trackingHeadline } from "@/lib/tracking";
import { Driver } from "@/types/type";

import { makeRide } from "../helpers/rides";
import { colors } from "../helpers/tokens";

const PICKUP = { latitude: 45.8, longitude: 15.945 };

const driverRow: Driver = {
  id: 3,
  first_name: "Michael",
  last_name: "Johnson",
  profile_image_url: "https://example.com/michael.jpg",
  car_image_url: "https://example.com/hatch.png",
  car_seats: 4,
  rating: "4.60",
};

const [michael] = generateMarkersFromData({
  data: [driverRow],
  pickup: PICKUP,
});

const CAR = { uri: "https://example.com/hatch.png" };
const imageSources = () =>
  screen.UNSAFE_getAllByType(Image).map((image) => image.props.source);

function renderCard(
  props: Partial<React.ComponentProps<typeof DriverCard>> = {},
) {
  const setSelected = jest.fn();
  render(
    <DriverCard
      item={michael}
      selected={null}
      setSelected={setSelected}
      fareCents={974}
      {...props}
    />,
  );
  return { setSelected, card: screen.getByTestId("driver-card-3") };
}

describe("DriverCard — what the rider is offered", () => {
  it("R45: shows the rating from the driver row, to one decimal", () => {
    renderCard();

    expect(screen.getByTestId("driver-rating")).toHaveTextContent("4.6");
  });

  it.each([
    ["5.00", "5.0"],
    ["4.75", "4.8"],
    ["3.20", "3.2"],
  ])("R45: a row rated %p shows %p", (rating, shown) => {
    const [driver] = generateMarkersFromData({
      data: [{ ...driverRow, rating }],
      pickup: PICKUP,
    });

    renderCard({ item: driver });

    expect(screen.getByTestId("driver-rating")).toHaveTextContent(shown);
  });

  it("shows the driver's name, seats and profile photo", () => {
    const { card } = renderCard();

    expect(within(card).getByText("Michael Johnson")).toBeOnTheScreen();
    expect(within(card).getByText("4 seats")).toBeOnTheScreen();
    expect(imageSources()).toContainEqual({
      uri: "https://example.com/michael.jpg",
    });
  });

  it("Q3: the fare is the quote's fareCents in euros", () => {
    renderCard({ fareCents: 1234 });

    expect(screen.getByTestId("driver-fare")).toHaveTextContent("€12.34");
  });

  it("Q1: while the trip is being quoted the fare reads '…'", () => {
    renderCard({ fareCents: null });

    expect(screen.getByTestId("driver-fare")).toHaveTextContent("…");
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it("R14: the pickup time is the marker's pickupMinutes — the first 'Arriving in' of the tracker", () => {
    renderCard();

    const booked = timelineFor(
      makeRide({ pickup_minutes: michael.pickupMinutes }),
    )!;
    const firstHeadline = trackingHeadline(
      phaseAt(booked, booked.departAtMs),
      booked,
    );
    expect(screen.getByTestId("driver-pickup")).toHaveTextContent(
      `${michael.pickupMinutes} min away`,
    );
    expect(firstHeadline.accent).toBe(`${michael.pickupMinutes} Mins`);
  });

  it("R14: a fractional pickupMinutes is rounded up, never promising a car sooner", () => {
    renderCard({ item: { ...michael, pickupMinutes: 6.2 } });

    expect(screen.getByTestId("driver-pickup")).toHaveTextContent("7 min away");
  });

  it("hidePickupTime (a scheduled ride) hides the per-driver minutes", () => {
    const { card } = renderCard({ hidePickupTime: true });

    expect(screen.queryByTestId("driver-pickup")).toBeNull();
    expect(screen.queryByText(/min away/)).toBeNull();
    expect(within(card).getByText("4 seats")).toBeOnTheScreen();
    expect(screen.getByTestId("driver-fare")).toHaveTextContent("€9.74");
  });
});

describe("DriverCard — selection (R74)", () => {
  it("R74: an unselected card is a radio, not checked, labelled with name and rating", () => {
    const { card } = renderCard({ selected: null });

    expect(card).toHaveProp("accessibilityRole", "radio");
    expect(card).not.toBeChecked();
    expect(card).toHaveProp("accessibilityLabel", "Michael Johnson, rated 4.6");
    expect(card).toHaveStyle({ backgroundColor: palette.white });
    expect(screen.queryByLabelText("Selected")).toBeNull();
    expect(imageSources()).toContainEqual(CAR);
  });

  it("R74: the selected card is a checked radio, shows the checkmark and the primary border", () => {
    const { card } = renderCard({ selected: 3 });

    expect(card).toBeChecked();
    expect(card).toHaveProp("accessibilityState", { checked: true });
    expect(within(card).getByLabelText("Selected")).toHaveProp(
      "source",
      icons.checkmark,
    );
    expect(imageSources()).not.toContainEqual(CAR);
    expect(card).toHaveStyle({
      backgroundColor: colors.general["600"],
      borderTopColor: colors.primary["500"],
    });
  });

  it("R74: the white check glyph is tinted primary-500, so it shows on the selected card's general-600", () => {
    renderCard({ selected: 3 });

    expect(screen.getByLabelText("Selected")).toHaveStyle({
      tintColor: colors.primary["500"],
      width: 24,
      height: 24,
    });
  });

  it("another driver's selection leaves this card unselected, showing its car", () => {
    const { card } = renderCard({ selected: 4 });

    expect(card).not.toBeChecked();
    expect(screen.queryByLabelText("Selected")).toBeNull();
    expect(imageSources()).toContainEqual(CAR);
  });

  it("pressing the card calls setSelected", () => {
    const { setSelected, card } = renderCard();

    fireEvent.press(card);

    expect(setSelected).toHaveBeenCalledTimes(1);
  });
});
