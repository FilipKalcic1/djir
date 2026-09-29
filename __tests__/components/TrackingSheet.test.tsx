/**
 * The tracking sheet, state by state (S1–S9 of the build plan's WP3 table,
 * Figma 14). Every ride state is built the way the screen builds it: the real
 * timeline, and the shipped simulated position at a fixed clock.
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { AccessibilityInfo, ActivityIndicator } from "react-native";

import TrackingSheet, { TrackingSheetState } from "@/components/TrackingSheet";
import {
  simulatedPosition,
  straightLegs,
  trackedRideFrom,
} from "@/lib/tracking";
import { Ride } from "@/types/type";

import { makeRide, MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

const PAID = Date.parse("2026-10-03T19:00:00.000Z"); // 21:00 in Zagreb
const SLOT = "2026-10-04T06:00:00.000Z"; // Sunday 08:00 in Zagreb

const rideNow = makeRide();
const scheduledRide = makeRide({ ride_id: 2, scheduled_at: SLOT });
const cancelledRide = makeRide({
  ride_id: 3,
  scheduled_at: SLOT,
  cancelled_at: "2026-10-03T19:30:00.000Z",
  payment_status: "refunded",
});

/** What track-ride.tsx hands the sheet for `ride` at `nowMs`. */
function rideState(ride: Ride, nowMs: number): TrackingSheetState {
  const tracked = trackedRideFrom(ride)!;
  const snapshot = simulatedPosition()(tracked, straightLegs(tracked), nowMs);
  return {
    kind: "ride",
    ride: tracked.ride,
    timeline: tracked.timeline,
    phase: snapshot,
    nowMs,
  };
}

const scheduled = () => rideState(scheduledRide, PAID);
const enRoute = (minutes = 0) => rideState(rideNow, PAID + minutes * MIN);
const arrived = () => rideState(rideNow, PAID + 7 * MIN);
const onTrip = () => rideState(rideNow, PAID + 8 * MIN);
const completed = () => rideState(rideNow, PAID + 20 * MIN);
const cancelled = () => rideState(cancelledRide, PAID);

function renderSheet(
  state: TrackingSheetState,
  props: Partial<React.ComponentProps<typeof TrackingSheet>> = {},
) {
  const onBackHome = jest.fn();
  render(<TrackingSheet state={state} onBackHome={onBackHome} {...props} />);
  return { onBackHome };
}

/** Every piece of copy inside a state without nested text, in reading order. */
const copyIn = (testID: string) =>
  within(screen.getByTestId(testID))
    .getAllByText(/./)
    .map((text) => text.props.children);

describe("TrackingSheet — S1 to S3 (no ride to show)", () => {
  it("S1: loading shows a spinner and 'Loading your ride…', with no actions", () => {
    renderSheet({ kind: "loading" });

    const loading = screen.getByTestId("tracking-loading");
    expect(within(loading).UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    expect(copyIn("tracking-loading")).toEqual(["Loading your ride…"]);
    expect(screen.queryByTestId("tracking-back-home")).toBeNull();
    expect(screen.queryByTestId("tracking-retry")).toBeNull();
  });

  it("S2: an error shows 'Couldn't load your ride' and the server's message", () => {
    renderSheet({ kind: "error", message: "Network request failed" });

    const error = screen.getByTestId("tracking-error");
    expect(within(error).getByRole("header")).toHaveTextContent(
      "Couldn't load your ride",
    );
    expect(copyIn("tracking-error")).toEqual([
      "Couldn't load your ride",
      "Network request failed",
      "Back Home",
    ]);
  });

  it("S2: Retry is offered when onRetry is given, and pressing it retries", () => {
    const onRetry = jest.fn();
    renderSheet({ kind: "error", message: "Server error" }, { onRetry });

    fireEvent.press(screen.getByTestId("tracking-retry"));

    expect(copyIn("tracking-error")).toEqual([
      "Couldn't load your ride",
      "Server error",
      "Retry",
      "Back Home",
    ]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("S2: there is no Retry without an onRetry handler", () => {
    renderSheet({ kind: "error", message: "Server error" });

    expect(screen.getByTestId("tracking-error")).toBeOnTheScreen();
    expect(screen.queryByTestId("tracking-retry")).toBeNull();
  });

  it("S3: an unknown ride shows 'Ride not found', no message and no Retry", () => {
    renderSheet({ kind: "not_found" }, { onRetry: jest.fn() });

    const notFound = screen.getByTestId("tracking-not-found");
    expect(within(notFound).getByRole("header")).toHaveTextContent(
      "Ride not found",
    );
    expect(copyIn("tracking-not-found")).toEqual([
      "Ride not found",
      "Back Home",
    ]);
    expect(screen.queryByTestId("tracking-retry")).toBeNull();
  });
});

describe("TrackingSheet — S4 to S9 (a ride, by phase)", () => {
  it.each([
    [
      "S4",
      "scheduled",
      "Pickup at 08:00",
      "08:00",
      "Tomorrow · your driver sets off at 07:53 · free cancellation until then",
      scheduled,
    ],
    ["S5", "en_route", "Arriving in 7 Mins", "7 Mins", null, () => enRoute(0)],
    ["S5", "en_route", "Arriving in 1 Min", "1 Min", null, () => enRoute(6)],
    ["S5", "en_route", "Arriving now", "now", null, () => enRoute(6.01)],
    [
      "S6",
      "arrived",
      "Your driver has arrived",
      "arrived",
      "Meet them at the pickup point",
      arrived,
    ],
    ["S7", "on_trip", "12 Mins to destination", "12 Mins", null, onTrip],
    [
      "S8",
      "completed",
      "Ride complete",
      "complete",
      "You've reached Trg bana Jelačića · Paid €9.74",
      completed,
    ],
    [
      "S9",
      "cancelled",
      "Ride cancelled",
      "cancelled",
      "Refund of €9.74 to your card · 5–10 days",
      cancelled,
    ],
  ])(
    "%s: the %s phase reads %p (accent %p), detail %p",
    (_, phase, headline, accent, detail, state) => {
      renderSheet(state());

      const title = screen.getByTestId("tracking-headline");
      // Green for every phase, except a cancellation: red, like its history badge.
      const accentColor =
        phase === "cancelled" ? colors.danger["600"] : colors.general["400"];
      expect(screen.getByTestId(`tracking-${phase}`)).toBeOnTheScreen();
      expect(title).toHaveTextContent(headline);
      expect(within(title).getByText(accent)).toHaveStyle({
        color: accentColor,
      });
      expect(title).not.toHaveStyle({ color: accentColor });
      if (detail === null) {
        expect(screen.queryByTestId("tracking-detail")).toBeNull();
      } else {
        expect(screen.getByTestId("tracking-detail")).toHaveTextContent(detail);
      }
    },
  );

  it("R74: the headline is announced as a header", () => {
    renderSheet(enRoute());

    expect(screen.getByRole("header")).toBe(
      screen.getByTestId("tracking-headline"),
    );
  });

  describe("R74: phase changes are read out, minutes are not", () => {
    // React Native's jest setup already makes this a mock: start each test clean.
    const announce = () =>
      jest
        .spyOn(AccessibilityInfo, "announceForAccessibility")
        .mockImplementation(() => {})
        .mockClear();
    const sheet = (state: TrackingSheetState) => (
      <TrackingSheet state={state} onBackHome={jest.fn()} />
    );
    afterEach(() => jest.restoreAllMocks());

    it("R74: each phase change is announced once, as the new headline", () => {
      const spoken = announce();
      const { rerender } = render(sheet(scheduled()));

      rerender(sheet(rideState(scheduledRide, Date.parse(SLOT) - 7 * MIN)));
      rerender(sheet(enRoute(6.5))); // "Arriving now": the same phase
      rerender(sheet(arrived()));
      rerender(sheet(onTrip()));
      rerender(sheet(completed()));

      expect(spoken.mock.calls).toEqual([
        ["Arriving in 7 Mins"],
        ["Your driver has arrived"],
        ["12 Mins to destination"],
        ["Ride complete"],
      ]);
    });

    it("R74: the countdown's minutes are not read out as they change — the headline is no live region", () => {
      const spoken = announce();
      const { rerender } = render(sheet(enRoute(0)));

      rerender(sheet(enRoute(1)));
      rerender(sheet(enRoute(2)));
      rerender(sheet(onTrip()));
      rerender(sheet(rideState(rideNow, PAID + 9 * MIN)));
      rerender(sheet(rideState(rideNow, PAID + 10 * MIN)));

      expect(screen.getByTestId("tracking-headline")).toHaveTextContent(
        "10 Mins to destination",
      );
      expect(screen.getByTestId("tracking-headline")).not.toHaveProp(
        "accessibilityLiveRegion",
      );
      expect(spoken.mock.calls).toEqual([["12 Mins to destination"]]);
    });

    it("R74: opening the tracker announces nothing — not while loading, not when the ride first shows", () => {
      const spoken = announce();
      const { rerender } = render(sheet({ kind: "loading" }));

      rerender(sheet(enRoute(0)));
      rerender(sheet(enRoute(0.5)));

      expect(screen.getByTestId("tracking-en_route")).toBeOnTheScreen();
      expect(spoken).not.toHaveBeenCalled();
    });
  });

  it("S4: a scheduled ride offers 'Cancel ride', and pressing it calls onCancel", () => {
    const onCancel = jest.fn();
    renderSheet(scheduled(), { onCancel });

    fireEvent.press(screen.getByTestId("ride-cancel"));

    expect(screen.getByTestId("ride-cancel")).toHaveTextContent("Cancel ride");
    expect(screen.getByTestId("ride-cancel")).toBeEnabled();
    expect(screen.getByTestId("ride-cancel")).toHaveStyle({
      backgroundColor: "transparent",
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("S4: without an onCancel handler there is no Cancel button", () => {
    renderSheet(scheduled());

    expect(screen.getByTestId("tracking-scheduled")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-cancel")).toBeNull();
  });

  it("S4: while cancelling, the button is disabled and shows a spinner instead of its title", () => {
    const onCancel = jest.fn();
    renderSheet(scheduled(), { onCancel, cancelling: true });

    const button = screen.getByTestId("ride-cancel");
    fireEvent.press(button);

    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    expect(within(button).UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    expect(within(button).queryByText("Cancel ride")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each([
    ["S5", enRoute],
    ["S6", arrived],
    ["S7", onTrip],
    ["S8", completed],
    ["S9", cancelled],
  ])("%s: no Cancel button once the driver has set off", (_, state) => {
    renderSheet(state(), { onCancel: jest.fn() });

    expect(screen.getByTestId("tracking-headline")).toBeOnTheScreen();
    expect(screen.queryByTestId("ride-cancel")).toBeNull();
  });
});

describe("TrackingSheet — X14: the ride could not be checked again", () => {
  it("X14: the ride as last loaded, with 'Couldn't check your ride' in danger-700, the message and Retry, which calls onRetry", () => {
    const onRetry = jest.fn();
    renderSheet(scheduled(), {
      onRetry,
      onCancel: jest.fn(),
      refreshError: "Network request failed",
    });

    const notice = screen.getByTestId("tracking-refresh-error");
    fireEvent.press(screen.getByTestId("tracking-refresh-retry"));

    expect(screen.getByTestId("tracking-scheduled")).toBeOnTheScreen();
    expect(copyIn("tracking-refresh-error")).toEqual([
      "Couldn't check your ride",
      "Network request failed",
      "Retry",
    ]);
    expect(within(notice).getByText("Couldn't check your ride")).toHaveStyle({
      color: colors.danger["700"],
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ride-cancel")).toBeEnabled();
  });

  it("X14: without an onRetry handler the notice has no Retry", () => {
    renderSheet(enRoute(), { refreshError: "Network request failed" });

    expect(copyIn("tracking-refresh-error")).toEqual([
      "Couldn't check your ride",
      "Network request failed",
    ]);
    expect(screen.queryByTestId("tracking-refresh-retry")).toBeNull();
  });

  it("X14: with nothing to report there is no notice", () => {
    renderSheet(enRoute(), { onRetry: jest.fn(), refreshError: null });

    expect(screen.getByTestId("tracking-headline")).toBeOnTheScreen();
    expect(screen.queryByTestId("tracking-refresh-error")).toBeNull();
  });
});

describe("TrackingSheet — Back Home and the Figma 14 elements", () => {
  it.each([
    ["S2", () => ({ kind: "error", message: "Server error" }) as const],
    ["S3", () => ({ kind: "not_found" }) as const],
    ["S4", scheduled],
    ["S5", enRoute],
    ["S6", arrived],
    ["S7", onTrip],
    ["S8", completed],
    ["S9", cancelled],
  ])("%s: Back Home calls onBackHome", (_, state) => {
    const { onBackHome } = renderSheet(state());

    fireEvent.press(screen.getByTestId("tracking-back-home"));

    expect(screen.getByTestId("tracking-back-home")).toHaveTextContent(
      "Back Home",
    );
    expect(onBackHome).toHaveBeenCalledTimes(1);
  });

  it("F6: Back Home is the primary button, bg-primary-500 (Figma 14)", () => {
    renderSheet(enRoute());

    expect(screen.getByTestId("tracking-back-home")).toHaveStyle({
      backgroundColor: colors.primary["500"],
    });
  });

  it("F3: the headline is text-xl in Jakarta SemiBold (Figma 14)", () => {
    renderSheet(enRoute());

    expect(screen.getByTestId("tracking-headline")).toHaveStyle({
      fontSize: 20,
      fontFamily: "Jakarta-SemiBold",
    });
  });

  it("F4: the driver card is a general-600 rounded-2xl p-4 box with the driver's avatar, name and car (Figma 14)", () => {
    renderSheet(enRoute());

    const card = screen.getByTestId("tracking-driver-card");
    expect(card).toHaveStyle({
      backgroundColor: colors.general["600"],
      borderTopLeftRadius: 16,
      paddingTop: 16,
    });
    expect(within(card).getByText("Michael Johnson")).toBeOnTheScreen();
    expect(within(card).getByLabelText("Michael Johnson")).toHaveProp(
      "source",
      { uri: "https://example.com/michael.jpg" },
    );
    expect(within(card).getByLabelText("Car")).toHaveProp("source", {
      uri: "https://example.com/hatch.png",
    });
  });

  it("a driver with no photos still gets the card, with empty image sources", () => {
    const noPhotos = makeRide({
      driver: {
        ...rideNow.driver,
        profile_image_url: null,
        car_image_url: null,
      },
    });
    renderSheet(rideState(noPhotos, PAID));

    const card = screen.getByTestId("tracking-driver-card");
    expect(within(card).getByLabelText("Michael Johnson")).toHaveProp(
      "source",
      { uri: undefined },
    );
    expect(within(card).getByLabelText("Car")).toHaveProp("source", {
      uri: undefined,
    });
  });

  it.each([
    ["S4", scheduled],
    ["S5", enRoute],
    ["S8", completed],
  ])(
    "F8 %s: the caption 'Simulated driver · Djir has no driver app yet' is shown in general-200",
    (_, state) => {
      renderSheet(state());

      const caption = screen.getByTestId("tracking-simulated");
      expect(caption).toHaveTextContent(
        "Simulated driver · Djir has no driver app yet",
      );
      expect(caption).toHaveStyle({ color: colors.general["200"] });
    },
  );

  it("F5: the pickup and drop-off rows show the ride's addresses (Figma 14)", () => {
    renderSheet(scheduled());

    expect(screen.getByTestId("route-summary-origin")).toHaveTextContent(
      "Tresnjevka, Zagreb",
    );
    expect(screen.getByTestId("route-summary-destination")).toHaveTextContent(
      "Trg bana Jelačića, Zagreb",
    );
  });
});
