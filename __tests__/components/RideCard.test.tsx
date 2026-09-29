/**
 * One ride in history (H1–H5 of the build plan's WP3 table). The status comes
 * from the real rideStatus() at a fixed clock, as RideList computes it.
 */
import { fireEvent, render, screen } from "@testing-library/react-native";

import RideCard, { staticMapUrl } from "@/components/RideCard";
import { rideStatus } from "@/lib/rides";
import { Ride } from "@/types/type";

import { makeRide, MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

// Paid 21:23 UTC, driver 7 min out: picked up at 23:30 in Zagreb.
const LIVE_PAID = Date.parse("2026-10-03T21:23:00.000Z");

const live = makeRide({ ride_id: 11, paid_at: "2026-10-03T21:23:00.000Z" });
const upcoming = makeRide({
  ride_id: 12,
  scheduled_at: "2026-10-04T06:00:00.000Z", // Sunday 08:00 in Zagreb
});
const completed = makeRide({ ride_id: 13 }); // paid 19:00 UTC, picked up 21:07 in Zagreb
const cancelled = makeRide({
  ride_id: 14,
  scheduled_at: "2026-10-05T06:00:00.000Z",
  cancelled_at: "2026-10-03T20:00:00.000Z",
  payment_status: "refunded",
});
// Booked before v1.1: no pickup time and no paid_at.
const legacy = makeRide({
  ride_id: 15,
  pickup_minutes: null,
  paid_at: null,
  created_at: "2026-09-12T21:30:00.000Z",
});

const NOW = LIVE_PAID + 3 * MIN;

function renderCard(ride: Ride, nowMs = NOW) {
  const onOpen = jest.fn();
  render(
    <RideCard ride={ride} status={rideStatus(ride, nowMs)} onOpen={onOpen} />,
  );
  return { onOpen };
}

describe("RideCard — H1 to H5", () => {
  it.each([
    {
      row: "H1",
      kind: "live",
      ride: live,
      badge: "live",
      badgeLabel: "Live",
      badgeColor: colors.general["400"],
      time: "3 Oct 2026, 23:30",
      payment: "Paid",
      paymentColor: colors.general["400"],
      action: "ride-card-track",
    },
    {
      row: "H2",
      kind: "upcoming",
      ride: upcoming,
      badge: "upcoming",
      badgeLabel: "Upcoming",
      badgeColor: colors.primary["500"],
      time: "4 Oct 2026, 08:00",
      payment: "Paid",
      paymentColor: colors.general["400"],
      action: "ride-card-view",
    },
    {
      row: "H3",
      kind: "completed",
      ride: completed,
      badge: null,
      badgeLabel: null,
      badgeColor: null,
      time: "3 Oct 2026, 21:07",
      payment: "Paid",
      paymentColor: colors.general["400"],
      action: null,
    },
    {
      row: "H4",
      kind: "cancelled",
      ride: cancelled,
      badge: "cancelled",
      badgeLabel: "Cancelled",
      badgeColor: colors.danger["600"],
      time: "5 Oct 2026, 08:00",
      payment: "Refunded",
      paymentColor: colors.general["200"],
      action: null,
    },
    {
      row: "H5",
      kind: "legacy",
      ride: legacy,
      badge: null,
      badgeLabel: null,
      badgeColor: null,
      time: "12 Sep 2026, 23:30",
      payment: "Paid",
      paymentColor: colors.general["400"],
      action: null,
    },
  ])(
    "$row: a $kind ride shows badge $badgeLabel, '$time', $payment and action $action",
    ({
      ride,
      badge,
      badgeLabel,
      badgeColor,
      time,
      payment,
      paymentColor,
      action,
    }) => {
      renderCard(ride);

      expect(screen.getByTestId(`ride-card-${ride.ride_id}`)).toBeOnTheScreen();
      if (badge === null) {
        expect(screen.queryByTestId(/^ride-badge-/)).toBeNull();
      } else {
        const pill = screen.getByTestId(`ride-badge-${badge}`);
        expect(pill).toHaveTextContent(badgeLabel!);
        expect(pill).toHaveStyle({ backgroundColor: badgeColor! });
      }
      expect(screen.getByTestId("ride-card-time")).toHaveTextContent(time);
      const paid = screen.getByTestId("ride-card-payment");
      expect(paid).toHaveTextContent(payment);
      expect(paid).toHaveStyle({ color: paymentColor });
      for (const button of ["ride-card-track", "ride-card-view"]) {
        if (button === action) {
          expect(screen.getByTestId(button)).toBeOnTheScreen();
        } else {
          expect(screen.queryByTestId(button)).toBeNull();
        }
      }
    },
  );

  it("R46: Date & Time is the pickup time of day on the Zagreb clock, not the trip duration", () => {
    renderCard(live);

    expect(screen.getByText("Date & Time")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-card-time")).toHaveTextContent(
      "3 Oct 2026, 23:30",
    );
    expect(screen.queryByText(/12 min/i)).toBeNull();
  });

  it("H1: Track is the primary button and opens the ride", () => {
    const { onOpen } = renderCard(live);

    const track = screen.getByTestId("ride-card-track");
    fireEvent.press(track);

    expect(track).toHaveTextContent("Track");
    expect(track).toHaveStyle({ backgroundColor: colors.primary["500"] });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(live);
  });

  it("H2: View ride is the outline button and opens the ride", () => {
    const { onOpen } = renderCard(upcoming);

    const view = screen.getByTestId("ride-card-view");
    fireEvent.press(view);

    expect(view).toHaveTextContent("View ride");
    expect(view).toHaveStyle({ backgroundColor: "transparent" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(upcoming);
  });

  it.each([
    ["H1", "Track", live, "ride-card-track", "Track ride to Trg bana Jelačića"],
    [
      "H2",
      "View ride",
      upcoming,
      "ride-card-view",
      "View ride to Trg bana Jelačića",
    ],
  ] as const)(
    "R74 %s: the %s button names the ride it opens",
    (_, __, ride, button, label) => {
      renderCard(ride);

      expect(screen.getByRole("button", { name: label })).toBe(
        screen.getByTestId(button),
      );
    },
  );

  it("T7: a ride with no stored pickup time is history — no Track button, whatever the clock", () => {
    renderCard(makeRide({ ride_id: 16, pickup_minutes: null }), LIVE_PAID);

    expect(screen.queryByTestId("ride-card-track")).toBeNull();
    expect(screen.queryByTestId(/^ride-badge-/)).toBeNull();
  });

  it("shows the driver's full name and the fare in euros", () => {
    renderCard(completed);

    expect(screen.getByText("Michael Johnson")).toBeOnTheScreen();
    expect(screen.getByText("€9.74")).toBeOnTheScreen();
  });

  it.each([
    ["Track", live, "ride-card-track"],
    ["View ride", upcoming, "ride-card-view"],
  ] as const)(
    "pressing %s without an onOpen handler is a no-op",
    (_, ride, button) => {
      render(<RideCard ride={ride} status={rideStatus(ride, NOW)} />);

      expect(() => fireEvent.press(screen.getByTestId(button))).not.toThrow();
    },
  );
});

describe("RideCard — the destination thumbnail", () => {
  it("is a Geoapify static map centred on the destination when a key is set", () => {
    expect(staticMapUrl(live, "key_1")).toBe(
      "https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=400" +
        "&center=lonlat:15.9775,45.8085&zoom=14&apiKey=key_1",
    );
  });

  it.each([undefined, ""])(
    "is never requested without a key (%p): the card shows a placeholder",
    (key) => {
      expect(staticMapUrl(live, key)).toBeNull();
    },
  );

  it("renders the placeholder in this test build, which has no Geoapify key", () => {
    renderCard(live);
    expect(screen.getByTestId("ride-card-map-placeholder")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Map of the destination")).toBeNull();
  });
});
