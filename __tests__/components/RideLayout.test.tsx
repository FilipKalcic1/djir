/**
 * The map-and-sheet layout of the booking and tracking screens: the sheet
 * keeps taps for place suggestions (R22), and screens can swap the map and
 * opt out of the scroll view when their content is a list (R48).
 */
import BottomSheet from "@gorhom/bottom-sheet";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { FlatList, ScrollView, Text, View } from "react-native";
// Mocks the gesture handler's native module (GestureHandlerRootView needs it).
import "react-native-gesture-handler/jestSetup";
import palette from "tailwindcss/colors";

import RideLayout from "@/components/RideLayout";

import { resetRouter, router } from "../helpers/mocks/expo-router";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@gorhom/bottom-sheet", () =>
  require("../helpers/mocks/bottom-sheet"),
);
jest.mock("@/components/Map", () => require("../helpers/mocks/booking-map"));

const DRIVERS = [{ id: 1 }, { id: 2 }, { id: 3 }];

function renderLayout(
  props: Partial<React.ComponentProps<typeof RideLayout>> = {},
) {
  render(
    <RideLayout title="Your Ride" {...props}>
      {props.children ?? <Text>Sheet content</Text>}
    </RideLayout>,
  );
}

beforeEach(() => {
  resetRouter();
});

describe("RideLayout — header", () => {
  it("F2: shows the title as a header", () => {
    renderLayout();

    const title = screen.getByTestId("ride-layout-title");
    expect(title).toHaveTextContent("Your Ride");
    expect(screen.getByRole("header")).toBe(title);
  });

  it("F1 R74: the back button is a button labelled 'Go back'", () => {
    renderLayout();

    expect(screen.getByRole("button", { name: "Go back" })).toBe(
      screen.getByTestId("ride-layout-back"),
    );
  });

  it("F1: the back button is a white circle (Figma 14)", () => {
    renderLayout();

    const back = screen.getByTestId("ride-layout-back");
    // The first host view inside the button.
    const [circle] = back.findAll(
      (node) => node !== back && typeof node.type === "string",
    );
    expect(circle).toHaveStyle({
      backgroundColor: palette.white,
      width: 40,
      height: 40,
      borderTopLeftRadius: 9999,
    });
  });

  it("back goes back in the router by default", () => {
    renderLayout();

    fireEvent.press(screen.getByTestId("ride-layout-back"));

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("an onBack handler replaces router.back", () => {
    const onBack = jest.fn();
    renderLayout({ onBack });

    fireEvent.press(screen.getByTestId("ride-layout-back"));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe("RideLayout — map and sheet", () => {
  it("R48: shows the booking map by default", () => {
    renderLayout();

    expect(screen.getByTestId("booking-map")).toBeOnTheScreen();
  });

  it("R48: a map prop replaces the booking map", () => {
    renderLayout({ map: <View testID="tracking-map" /> });

    expect(screen.getByTestId("tracking-map")).toBeOnTheScreen();
    expect(screen.queryByTestId("booking-map")).toBeNull();
  });

  it("R22: the sheet is a scroll view that keeps taps for place suggestions", () => {
    renderLayout();

    const sheet = screen.getByTestId("ride-layout-sheet");
    expect(sheet).toHaveProp("keyboardShouldPersistTaps", "handled");
    expect(screen.UNSAFE_getByType(ScrollView).props.testID).toBe(
      "ride-layout-sheet",
    );
    expect(screen.getByText("Sheet content")).toBeOnTheScreen();
  });

  it("R48: scrollable={false} gives a plain container, so a list is not nested in a scroll view", () => {
    renderLayout({
      scrollable: false,
      children: (
        <FlatList
          testID="driver-list"
          data={DRIVERS}
          keyExtractor={(d) => String(d.id)}
          renderItem={({ item }) => <Text>Driver {item.id}</Text>}
        />
      ),
    });

    const scrollViews = screen.UNSAFE_getAllByType(ScrollView);
    expect(scrollViews).toHaveLength(1);
    expect(scrollViews[0].props.testID).toBe("driver-list");
    expect(screen.getByTestId("ride-layout-sheet")).not.toHaveProp(
      "keyboardShouldPersistTaps",
    );
    expect(screen.getByText("Driver 3")).toBeOnTheScreen();
  });

  it("R48: by contrast, the scrolling sheet would wrap that list in a second scroll view", () => {
    renderLayout({
      children: (
        <FlatList
          testID="driver-list"
          data={DRIVERS}
          keyExtractor={(d) => String(d.id)}
          renderItem={({ item }) => <Text>Driver {item.id}</Text>}
        />
      ),
    });

    expect(screen.UNSAFE_getAllByType(ScrollView)).toHaveLength(2);
  });

  it("opens the sheet at its first snap point, 40% / 85% by default", () => {
    renderLayout();

    const sheet = screen.UNSAFE_getByType(BottomSheet);
    expect(sheet.props.snapPoints).toEqual(["40%", "85%"]);
    expect(sheet.props.index).toBe(0);
  });

  it("passes custom snap points to the sheet", () => {
    renderLayout({ snapPoints: ["65%", "85%"] });

    expect(screen.UNSAFE_getByType(BottomSheet).props.snapPoints).toEqual([
      "65%",
      "85%",
    ]);
  });
});
