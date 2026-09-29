/**
 * The web build's tracking map (MP5, MP6): the ride drawn from the same ride
 * and snapshot as the native map, projected into the part of the map the
 * header and the sheet leave clear. Scenes come from the shipped simulated
 * position at a fixed clock; the map's size comes from a layout event.
 */
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import TrackingMap, {
  drawingInsets,
  Insets,
  Point,
  projector,
  screenInsets,
  SIMULATED_LABEL,
} from "@/components/TrackingMap.web";
import { icons } from "@/constants";
import {
  simulatedPosition,
  straightLegs,
  TrackedRide,
  trackedRideFrom,
} from "@/lib/tracking";

import { makeRide, MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

const PAID = Date.parse("2026-10-03T19:00:00.000Z");
const PHONE = { width: 390, height: 844 };
/** What track-ride passes: its sheet rests at 45% (to the native map too). */
const SHEET = 0.45;

const rideNow = trackedRideFrom(makeRide())!;
const scheduledRide = trackedRideFrom(
  makeRide({ ride_id: 2, scheduled_at: "2026-10-04T06:00:00.000Z" }),
)!;
const cancelledRide = trackedRideFrom(
  makeRide({
    ride_id: 3,
    scheduled_at: "2026-10-04T06:00:00.000Z",
    cancelled_at: "2026-10-03T19:30:00.000Z",
    payment_status: "refunded",
  }),
)!;

/** What track-ride.tsx hands the map for `tracked` at `nowMs`. */
const snapshotAt = (tracked: TrackedRide, nowMs: number) =>
  simulatedPosition()(tracked, straightLegs(tracked), nowMs);

/** Where the map puts `tracked`'s points in a phone-sized map with `clear`. */
const placeFor = (tracked: TrackedRide, clear = screenInsets(PHONE, SHEET)) =>
  projector(
    [tracked.driverStart, tracked.pickup, tracked.destination],
    PHONE,
    drawingInsets(clear),
  );

/** The style of a 4 px line from `from` to `to`, centred on its midpoint and turned. */
const lineStyle = (from: Point, to: Point, color: string) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return {
    position: "absolute",
    left: (from.x + to.x) / 2 - length / 2,
    top: (from.y + to.y) / 2 - 2,
    width: length,
    height: 4,
    borderRadius: 2,
    backgroundColor: color,
    transform: [{ rotate: `${Math.atan2(to.y - from.y, to.x - from.x)}rad` }],
  };
};

const styleOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style);

/** Renders the map as track-ride does (a 45% sheet) and gives it `box` as its layout. */
function renderMap(
  tracked: TrackedRide,
  nowMs: number,
  {
    box = PHONE,
    coveredBottom = SHEET,
    insets,
  }: { box?: typeof PHONE; coveredBottom?: number; insets?: Insets } = {},
) {
  const utils = render(
    <TrackingMap
      ride={tracked}
      snapshot={snapshotAt(tracked, nowMs)}
      coveredBottom={coveredBottom}
      insets={insets}
    />,
  );
  fireEvent(screen.getByTestId("tracking-map-web"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, ...box } },
  });
  return utils;
}

describe("projector — the map's own projection", () => {
  const south = { latitude: 45.8, longitude: 15.9 };
  const north = { latitude: 45.9, longitude: 16.0 };
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  it("MP5: north is up, one scale for both axes (longitude shrunk by cos latitude), the bounds centred", () => {
    const at = projector([south, north], { width: 200, height: 200 }, none);
    const kx = Math.cos((45.85 * Math.PI) / 180);
    const scale = 200 / 0.1; // the latitude span fills the height
    const halfWidth = (0.1 * kx * scale) / 2;

    expect(at(north).y).toBeCloseTo(0, 6);
    expect(at(south).y).toBeCloseTo(200, 6);
    expect(at(south).x).toBeCloseTo(100 - halfWidth, 6);
    expect(at(north).x).toBeCloseTo(100 + halfWidth, 6);
  });

  it("MP5: keeps every point inside the box less its insets", () => {
    const insets = { top: 112, right: 20, bottom: 380, left: 10 };
    const at = projector([south, north], PHONE, insets);

    for (const p of [south, north].map(at)) {
      expect(p.x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(390 - 20 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(112 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(844 - 380 + 1e-9);
    }
    // The longitude span is the narrower one here, so the height is filled.
    expect(at(north).y).toBeCloseTo(112, 6);
    expect(at(south).y).toBeCloseTo(844 - 380, 6);
  });

  it("MP5: a wide route fills the width, centred vertically", () => {
    const west = { latitude: 45.8, longitude: 15.9 };
    const east = { latitude: 45.8, longitude: 16.0 };
    const at = projector([west, east], { width: 300, height: 100 }, none);

    expect(at(west)).toEqual({ x: 0, y: 50 });
    expect(at(east).x).toBeCloseTo(300, 6);
    expect(at(east).y).toBe(50);
  });

  it("MP5: points that coincide sit in the middle of the clear area", () => {
    const at = projector([south, south], PHONE, {
      top: 100,
      right: 0,
      bottom: 300,
      left: 0,
    });

    expect(at(south)).toEqual({ x: 195, y: 100 + (844 - 400) / 2 });
  });

  it("MP5: a box smaller than its insets draws everything at one point instead of throwing", () => {
    const at = projector(
      [south, north],
      { width: 50, height: 50 },
      {
        top: 40,
        right: 40,
        bottom: 40,
        left: 40,
      },
    );

    expect(at(south)).toEqual(at(north));
  });

  it("MP5: track-ride leaves clear what RideLayout's header and the 45% sheet do not cover", () => {
    expect(screenInsets(PHONE, 0.45)).toEqual({
      top: 112,
      right: 0,
      bottom: 380,
      left: 0,
    });
    expect(screenInsets(PHONE, 0)).toEqual({
      top: 112,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(drawingInsets({ top: 112, right: 0, bottom: 380, left: 0 })).toEqual(
      { top: 152, right: 32, bottom: 436, left: 32 },
    );
  });
});

describe("TrackingMap on the web — the ride drawn from the ride and the snapshot", () => {
  it("MP5: before its first layout it draws no route and no label", () => {
    render(<TrackingMap ride={rideNow} snapshot={snapshotAt(rideNow, PAID)} />);

    expect(screen.getByTestId("tracking-map-web")).toHaveProp(
      "accessibilityLabel",
      `Map: ${SIMULATED_LABEL}`,
    );
    for (const id of [
      "tracking-leg-pickup",
      "tracking-leg-destination",
      "tracking-pickup",
      "tracking-destination",
      "tracking-car",
      "tracking-map-label",
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it("MP5: both straight legs in primary-300, from the driver's start to the pickup to the destination", () => {
    renderMap(rideNow, PAID + 3.5 * MIN);
    const at = placeFor(rideNow);

    expect(styleOf("tracking-leg-pickup")).toEqual(
      lineStyle(
        at(rideNow.driverStart),
        at(rideNow.pickup),
        colors.primary["300"],
      ),
    );
    expect(styleOf("tracking-leg-destination")).toEqual(
      lineStyle(
        at(rideNow.pickup),
        at(rideNow.destination),
        colors.primary["300"],
      ),
    );
  });

  it("MP5: the driver's start (secondary-500), the pickup ring (primary-500) and the destination pin, each on its point", () => {
    renderMap(rideNow, PAID + 3.5 * MIN);
    const at = placeFor(rideNow);
    const start = at(rideNow.driverStart);
    const pickup = at(rideNow.pickup);
    const destination = at(rideNow.destination);

    expect(styleOf("tracking-start")).toMatchObject({
      left: start.x - 5,
      top: start.y - 5,
      width: 10,
      height: 10,
      backgroundColor: colors.secondary["500"],
    });
    expect(styleOf("tracking-pickup")).toMatchObject({
      left: pickup.x - 9,
      top: pickup.y - 9,
      width: 18,
      height: 18,
      borderWidth: 4,
      borderColor: colors.primary["500"],
      backgroundColor: "white",
    });
    expect(screen.getByTestId("tracking-destination")).toHaveProp(
      "source",
      icons.pin,
    );
    // The pin's tip (bottom centre) is on the destination.
    expect(styleOf("tracking-destination")).toMatchObject({
      left: destination.x - 13,
      top: destination.y - 31,
      width: 26,
      height: 31,
    });
  });

  it("MP5: every point of the route lands in the clear area, clear of the header and the sheet", () => {
    renderMap(rideNow, PAID + 3.5 * MIN);
    const at = placeFor(rideNow);

    for (const p of [
      rideNow.driverStart,
      rideNow.pickup,
      rideNow.destination,
    ].map(at)) {
      expect(p.x).toBeGreaterThanOrEqual(32 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(390 - 32 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(112 + 40 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(844 - 380 - 56 + 1e-9);
    }
  });

  it("MP5: says the position is simulated, in a white pill just above the sheet", () => {
    renderMap(rideNow, PAID + 3.5 * MIN);

    expect(screen.getByTestId("tracking-map-label")).toHaveTextContent(
      "Simulated position · map in the iOS and Android app",
    );
    expect(styleOf("tracking-map-label")).toMatchObject({
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 380 + 12,
    });
    expect(
      StyleSheet.flatten(screen.getByText(SIMULATED_LABEL).props.style),
    ).toMatchObject({
      fontSize: 12,
      fontFamily: "Jakarta-Medium",
      color: colors.secondary["700"],
      backgroundColor: "#fff",
    });
  });

  it("MP5: the sheet's share is the coveredBottom track-ride passes, as on native; with none, only the header is kept clear", () => {
    const { unmount } = renderMap(rideNow, PAID + 3.5 * MIN, {
      coveredBottom: 0.3,
    });

    expect(styleOf("tracking-map-label")).toMatchObject({
      bottom: Math.round(844 * 0.3) + 12,
    });
    unmount();

    render(<TrackingMap ride={rideNow} snapshot={snapshotAt(rideNow, PAID)} />);
    fireEvent(screen.getByTestId("tracking-map-web"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, ...PHONE } },
    });
    const at = placeFor(rideNow, screenInsets(PHONE, 0));

    expect(styleOf("tracking-map-label")).toMatchObject({ bottom: 12 });
    expect(styleOf("tracking-leg-pickup")).toEqual(
      lineStyle(
        at(rideNow.driverStart),
        at(rideNow.pickup),
        colors.primary["300"],
      ),
    );
  });

  it("MP5: explicit insets (the README hero has no header or sheet) move the drawing and the label", () => {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    renderMap(rideNow, PAID + 3.5 * MIN, { insets: none });
    const at = placeFor(rideNow, none);

    expect(styleOf("tracking-leg-destination")).toEqual(
      lineStyle(
        at(rideNow.pickup),
        at(rideNow.destination),
        colors.primary["300"],
      ),
    );
    expect(styleOf("tracking-map-label")).toMatchObject({ bottom: 12 });
  });

  it("MP5: a new size redraws the route at that size", () => {
    renderMap(rideNow, PAID + 3.5 * MIN);
    const wide = { width: 800, height: 500 };
    fireEvent(screen.getByTestId("tracking-map-web"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, ...wide } },
    });
    const at = projector(
      [rideNow.driverStart, rideNow.pickup, rideNow.destination],
      wide,
      drawingInsets(screenInsets(wide, SHEET)),
    );

    expect(styleOf("tracking-leg-pickup")).toEqual(
      lineStyle(
        at(rideNow.driverStart),
        at(rideNow.pickup),
        colors.primary["300"],
      ),
    );
  });
});

describe("TrackingMap on the web — the car and its line per phase (as MP1–MP4)", () => {
  it.each([
    ["scheduled", scheduledRide, PAID],
    ["en_route", rideNow, PAID + 3.5 * MIN],
    ["arrived", rideNow, PAID + 7.5 * MIN],
    ["on_trip", rideNow, PAID + 14 * MIN],
    ["cancelled", cancelledRide, PAID],
  ] as const)(
    "MP6: %s: the car icon on the snapshot's position, turned to its heading",
    (phase, tracked, nowMs) => {
      const snapshot = snapshotAt(tracked, nowMs);
      renderMap(tracked, nowMs);
      const car = placeFor(tracked)(snapshot.car);

      expect(snapshot.phase).toBe(phase);
      expect(screen.getByTestId("tracking-car")).toHaveProp(
        "source",
        icons.marker,
      );
      expect(styleOf("tracking-car")).toEqual({
        position: "absolute",
        left: car.x - 18,
        top: car.y - 18,
        width: 36,
        height: 36,
        transform: [{ rotate: `${snapshot.headingDeg}deg` }],
      });
    },
  );

  it("MP6: scheduled and cancelled: the car waits at its start and no line is drawn", () => {
    for (const tracked of [scheduledRide, cancelledRide]) {
      const { unmount } = renderMap(tracked, PAID);
      const at = placeFor(tracked);

      expect(styleOf("tracking-car")).toMatchObject({
        left: at(tracked.driverStart).x - 18,
        top: at(tracked.driverStart).y - 18,
      });
      expect(screen.queryByTestId("tracking-route")).toBeNull();
      unmount();
    }
  });

  it("MP6: en_route: a primary-500 line from the car to the pickup", () => {
    const nowMs = PAID + 3.5 * MIN;
    const snapshot = snapshotAt(rideNow, nowMs);
    renderMap(rideNow, nowMs);
    const at = placeFor(rideNow);

    expect(snapshot.car).not.toEqual(rideNow.driverStart);
    expect(styleOf("tracking-route")).toEqual(
      lineStyle(at(snapshot.car), at(rideNow.pickup), colors.primary["500"]),
    );
  });

  it("MP6: arrived: the car is on the pickup, and its line has no length", () => {
    renderMap(rideNow, PAID + 7.5 * MIN);
    const pickup = placeFor(rideNow)(rideNow.pickup);

    expect(styleOf("tracking-car")).toMatchObject({
      left: pickup.x - 18,
      top: pickup.y - 18,
    });
    expect(styleOf("tracking-route")).toMatchObject({ width: 0 });
  });

  it("MP6: on_trip: a primary-500 line from the car to the destination", () => {
    const nowMs = PAID + 14 * MIN;
    const snapshot = snapshotAt(rideNow, nowMs);
    renderMap(rideNow, nowMs);
    const at = placeFor(rideNow);

    expect(styleOf("tracking-route")).toEqual(
      lineStyle(
        at(snapshot.car),
        at(rideNow.destination),
        colors.primary["500"],
      ),
    );
  });

  it("MP6: completed: no car and no line; the legs and both pins stay", () => {
    renderMap(rideNow, PAID + 20 * MIN);

    expect(screen.queryByTestId("tracking-car")).toBeNull();
    expect(screen.queryByTestId("tracking-route")).toBeNull();
    for (const id of [
      "tracking-leg-pickup",
      "tracking-leg-destination",
      "tracking-pickup",
      "tracking-destination",
    ]) {
      expect(screen.getByTestId(id)).toBeOnTheScreen();
    }
  });
});
