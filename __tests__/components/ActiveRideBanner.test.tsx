/**
 * Home's way back into a ride (B1–B4 of the build plan's WP3 table). Phases
 * come from the real timeline at a fixed clock; history order from the real
 * sortRidesForHistory(), as useRides() hands it to Home.
 */
import { fireEvent, render, screen } from "@testing-library/react-native";

import ActiveRideBanner from "@/components/ActiveRideBanner";
import { sortRidesForHistory } from "@/lib/rides";
import { phaseAt, timelineFor, trackingHeadline } from "@/lib/tracking";
import { Ride } from "@/types/type";

import { makeRide, MIN } from "../helpers/rides";

const PAID = Date.parse("2026-10-03T19:00:00.000Z"); // Saturday 21:00 in Zagreb

const live = makeRide({ ride_id: 1 });
const tomorrow = makeRide({
  ride_id: 2,
  scheduled_at: "2026-10-04T06:00:00.000Z", // Sunday 08:00 in Zagreb
});
const tuesday = makeRide({
  ride_id: 3,
  scheduled_at: "2026-10-06T06:00:00.000Z", // Tuesday 08:00 in Zagreb
});
const legacy = makeRide({ ride_id: 4, pickup_minutes: null, paid_at: null });
const cancelled = makeRide({
  ride_id: 5,
  scheduled_at: "2026-10-05T06:00:00.000Z",
  cancelled_at: "2026-10-03T18:00:00.000Z",
  payment_status: "refunded",
});

function renderBanner(rides: Ride[], nowMs: number, speedup?: number) {
  const onOpen = jest.fn();
  render(
    <ActiveRideBanner
      rides={rides}
      nowMs={nowMs}
      speedup={speedup}
      onOpen={onOpen}
    />,
  );
  return { onOpen };
}

describe("ActiveRideBanner — B1 live", () => {
  it.each([
    ["B1a", "en route", 0, "Michael is arriving in 7 min"],
    ["B1a", "en route with 1 min left", 6, "Michael is arriving in 1 min"],
    [
      "B1d",
      "en route with under a minute left",
      6.01,
      "Michael is arriving now",
    ],
    ["B1d", "en route with half a minute left", 6.5, "Michael is arriving now"],
    ["B1b", "arrived", 7, "Michael has arrived"],
    ["B1c", "on the trip", 8, "12 min to Trg bana Jelačića"],
    ["B1c", "near the end of the trip", 19.99, "1 min to Trg bana Jelačića"],
  ])("%s: %s (+%p min) reads %p", (_, __, minutes, text) => {
    renderBanner([live], PAID + minutes * MIN);

    const banner = screen.getByTestId("active-ride-live");
    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(screen.getByText("Live")).toBeOnTheScreen();
    expect(screen.getByText("Track ›")).toBeOnTheScreen();
    expect(banner).toHaveProp(
      "accessibilityLabel",
      `Live ride: ${text}. Track`,
    );
  });

  it("R74: the live banner is a button labelled 'Live ride: … Track'", () => {
    renderBanner([live], PAID);

    expect(screen.getByRole("button")).toBe(
      screen.getByTestId("active-ride-live"),
    );
    expect(
      screen.getByLabelText("Live ride: Michael is arriving in 7 min. Track"),
    ).toBe(screen.getByTestId("active-ride-live"));
  });

  it("B1a: pressing the live banner opens that ride", () => {
    const { onOpen } = renderBanner([live], PAID);

    fireEvent.press(screen.getByTestId("active-ride-live"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(live);
  });

  it("B1d T2: in the pickup leg's last minute the banner and the tracker both say 'now'", () => {
    const nowMs = PAID + 6.5 * MIN;
    const timeline = timelineFor(live)!;
    const headline = trackingHeadline(phaseAt(timeline, nowMs), timeline);

    renderBanner([live], nowMs);

    expect(headline.lead + headline.accent).toBe("Arriving now");
    expect(screen.getByText("Michael is arriving now")).toBeOnTheScreen();
  });

  it("B1c: honours the demo speed-up (30 real s at ×20 is 10 simulated min in)", () => {
    renderBanner([live], PAID + 30_000, 20);

    expect(screen.getByText("10 min to Trg bana Jelačića")).toBeOnTheScreen();
  });
});

describe("ActiveRideBanner — B2 upcoming", () => {
  it("B2: a ride tomorrow reads 'Tomorrow · 08:00', labelled 'Upcoming ride: … View'", () => {
    renderBanner([tomorrow], PAID);

    const banner = screen.getByTestId("active-ride-upcoming");
    expect(screen.getByText("Upcoming")).toBeOnTheScreen();
    expect(screen.getByText("Tomorrow · 08:00")).toBeOnTheScreen();
    expect(screen.getByText("View ›")).toBeOnTheScreen();
    expect(banner).toHaveProp(
      "accessibilityLabel",
      "Upcoming ride: Tomorrow · 08:00. View",
    );
    expect(banner).toHaveProp("accessibilityRole", "button");
  });

  it("B2: a ride later in the week reads with its weekday and date", () => {
    renderBanner([tuesday], PAID);

    expect(screen.getByText("Tue 6 Oct · 08:00")).toBeOnTheScreen();
  });

  it("B2: pressing the upcoming banner opens that ride", () => {
    const { onOpen } = renderBanner([tomorrow], PAID);

    fireEvent.press(screen.getByTestId("active-ride-upcoming"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(tomorrow);
  });
});

describe("ActiveRideBanner — B3 nothing to show, B4 which ride wins", () => {
  it.each([
    ["no rides at all", [], PAID],
    ["a completed ride", [live], PAID + 20 * MIN],
    ["a cancelled ride", [cancelled], PAID],
    [
      "a scheduled ride whose trip has ended",
      [tomorrow],
      Date.parse("2026-10-04T07:00:00.000Z"),
    ],
  ])("B3: %s renders nothing", (_, rides, nowMs) => {
    renderBanner(rides as Ride[], nowMs);

    expect(screen.toJSON()).toBeNull();
  });

  it("T7: a ride with pickup_minutes null never shows, even while it would be live", () => {
    renderBanner([makeRide({ pickup_minutes: null })], PAID);

    expect(screen.toJSON()).toBeNull();
  });

  it("T7: a legacy ride is skipped in favour of the next active one", () => {
    renderBanner([legacy, tomorrow], PAID);

    expect(screen.getByTestId("active-ride-upcoming")).toBeOnTheScreen();
    expect(screen.getByText("Tomorrow · 08:00")).toBeOnTheScreen();
  });

  it("B4: in history order a live ride wins over an upcoming one", () => {
    const rides = sortRidesForHistory([tuesday, tomorrow, live, legacy], PAID);
    const { onOpen } = renderBanner(rides, PAID);

    fireEvent.press(screen.getByTestId("active-ride-live"));

    expect(screen.queryByTestId("active-ride-upcoming")).toBeNull();
    expect(onOpen).toHaveBeenCalledWith(live);
  });

  it("B4 K8: a live ride wins even when the list puts an upcoming one first", () => {
    const { onOpen } = renderBanner([tomorrow, legacy, live], PAID);

    fireEvent.press(screen.getByTestId("active-ride-live"));

    expect(screen.queryByTestId("active-ride-upcoming")).toBeNull();
    expect(onOpen).toHaveBeenCalledWith(live);
  });

  it.each([
    [
      "history order",
      sortRidesForHistory([tuesday, cancelled, tomorrow], PAID),
    ],
    ["the later ride listed first", [tuesday, cancelled, tomorrow]],
  ])(
    "B4: with no live ride, the soonest upcoming one wins (%s)",
    (_, rides) => {
      const { onOpen } = renderBanner(rides, PAID);

      fireEvent.press(screen.getByTestId("active-ride-upcoming"));

      expect(screen.getByText("Tomorrow · 08:00")).toBeOnTheScreen();
      expect(onOpen).toHaveBeenCalledWith(tomorrow);
    },
  );
});
