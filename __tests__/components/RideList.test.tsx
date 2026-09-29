/**
 * Ride history as Home and the Rides tab show it (H8–H10 of the build plan's
 * WP3 table, R47): its loading, empty and error states, pull-to-refresh, and
 * the way into a ride. Cards get their status from the real rideStatus() at a
 * fixed clock; navigation is the shared expo-router mock.
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { ActivityIndicator, RefreshControl, Text } from "react-native";

import RideList, { openRide } from "@/components/RideList";

import { resetRouter, router } from "../helpers/mocks/expo-router";
import { makeRide, MIN } from "../helpers/rides";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));

const PAID = Date.parse("2026-10-03T19:00:00.000Z"); // 21:00 in Zagreb
const NOW = PAID + 3 * MIN; // ride 11's driver is on his way
const live = makeRide({ ride_id: 11 });
const upcoming = makeRide({
  ride_id: 12,
  scheduled_at: "2026-10-04T06:00:00.000Z", // Sunday 08:00 in Zagreb
});

function renderList(
  props: Partial<React.ComponentProps<typeof RideList>> = {},
) {
  const onRefresh = jest.fn();
  render(
    <RideList
      rides={[]}
      loading={false}
      error={null}
      nowMs={NOW}
      speedup={1}
      onRefresh={onRefresh}
      header={<Text testID="rides-header">All Rides</Text>}
      {...props}
    />,
  );
  return { onRefresh };
}

// Read props off the composite instances: printing one on a failure would
// walk the whole FlatList.
const pullToRefresh = () => screen.UNSAFE_getByType(RefreshControl).props;
const spinnerTestIDs = () =>
  screen.UNSAFE_queryAllByType(ActivityIndicator).map((s) => s.props.testID);

beforeEach(() => {
  resetRouter();
});

describe("RideList — H8 to H10 (no cards to show)", () => {
  it("H8: the first load shows a spinner under the header, and nothing else", () => {
    renderList({ loading: true });

    expect(spinnerTestIDs()).toEqual(["rides-loading"]);
    expect(screen.getByTestId("rides-loading")).toHaveProp(
      "accessibilityLabel",
      "Loading your rides",
    );
    expect(screen.getByTestId("rides-header")).toHaveTextContent("All Rides");
    expect(screen.queryByTestId("rides-empty")).toBeNull();
    expect(screen.queryByTestId("rides-error")).toBeNull();
    expect(pullToRefresh().refreshing).toBe(false); // one spinner, not two
  });

  it("H9: an empty history reads 'No rides yet'", () => {
    renderList();

    const empty = screen.getByTestId("rides-empty");
    expect(within(empty).getByText("No rides yet")).toBeOnTheScreen();
    expect(within(empty).getByLabelText("No rides yet")).toBeOnTheScreen();
    expect(screen.queryByTestId("rides-loading")).toBeNull();
    expect(screen.queryByTestId("rides-error")).toBeNull();
  });

  it("H10: a failed load reads 'Couldn't load your rides' with the server's message, and Retry reloads", () => {
    const { onRefresh } = renderList({ error: "Database unavailable" });

    const error = screen.getByTestId("rides-error");
    expect(
      within(error)
        .getAllByText(/./)
        .map((text) => text.props.children),
    ).toEqual(["Couldn't load your rides", "Database unavailable", "Retry"]);
    expect(screen.queryByTestId("rides-empty")).toBeNull();

    fireEvent.press(within(error).getByTestId("rides-retry"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("H8: a reload after an error shows the spinner again, not the stale error", () => {
    renderList({ loading: true, error: "Database unavailable" });

    expect(screen.getByTestId("rides-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("rides-error")).toBeNull();
  });
});

describe("RideList — cards, refresh and the way into a ride", () => {
  it("shows one card per ride, in the order given, under the header", () => {
    renderList({ rides: [live, upcoming] });

    expect(
      screen.getAllByTestId(/^ride-card-\d+$/).map((card) => card.props.testID),
    ).toEqual(["ride-card-11", "ride-card-12"]);
    expect(screen.getByTestId("ride-badge-live")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-badge-upcoming")).toBeOnTheScreen();
    expect(screen.queryByTestId("rides-empty")).toBeNull();
  });

  it("R47: pulling down calls onRefresh, and the pull spinner shows while rides reload", () => {
    const { onRefresh } = renderList({ rides: [live], loading: true });

    pullToRefresh().onRefresh();

    expect(pullToRefresh().refreshing).toBe(true);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(spinnerTestIDs()).toEqual([]);
  });

  it("R47: a refresh that fails keeps the rides already shown", () => {
    renderList({ rides: [live], error: "Network request failed" });

    expect(screen.getByTestId("ride-card-11")).toBeOnTheScreen();
    expect(screen.queryByTestId("rides-error")).toBeNull();
    expect(pullToRefresh().refreshing).toBe(false);
  });

  it.each([
    ["H1", "Track", live, "ride-card-track", "11"],
    ["H2", "View ride", upcoming, "ride-card-view", "12"],
  ] as const)(
    "%s: %s pushes /(root)/track-ride with the ride's id",
    (_, __, ride, button, rideId) => {
      renderList({ rides: [ride] });

      fireEvent.press(screen.getByTestId(button));

      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith({
        pathname: "/(root)/track-ride",
        params: { rideId },
      });
    },
  );

  it("B2: openRide, the Home banner's handler, pushes the same tracker", () => {
    openRide(upcoming);

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/(root)/track-ride",
      params: { rideId: "12" },
    });
  });
});
