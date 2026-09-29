/**
 * The live-tracking map (the build plan's map-per-phase table, R51). Scenes are
 * built from the shipped simulated position at a fixed clock; the shared
 * react-native-maps mock's ref records the camera's fitToCoordinates calls.
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { Dimensions, Image, StyleSheet, View } from "react-native";

import TrackingMap, {
  FRAME_MARGIN_PX,
  frameInsets,
  HEADER_INSET_PX,
  mapScene,
} from "@/components/TrackingMap";
import { icons } from "@/constants";
import { regionCorners, regionFor } from "@/lib/map";
import {
  simulatedPosition,
  straightLegs,
  TrackedRide,
  trackedRideFrom,
} from "@/lib/tracking";

import {
  animateToRegion,
  fitToCoordinates,
  resetMaps,
} from "../helpers/mocks/react-native-maps";
import { makeRide, MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

jest.mock("react-native-maps", () =>
  require("../helpers/mocks/react-native-maps"),
);

const PAID = Date.parse("2026-10-03T19:00:00.000Z");

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

const scheduledAt = () => snapshotAt(scheduledRide, PAID);
const enRouteAt = (minutes = 3.5) => snapshotAt(rideNow, PAID + minutes * MIN);
const arrivedAt = () => snapshotAt(rideNow, PAID + 7.5 * MIN);
const onTripAt = () => snapshotAt(rideNow, PAID + 14 * MIN);
const completedAt = () => snapshotAt(rideNow, PAID + 20 * MIN);
const cancelledAt = () => snapshotAt(cancelledRide, PAID);

type Snap = ReturnType<typeof enRouteAt>;
/** RideLayout's map is h-screen: the window's height. */
const HEIGHT = Dimensions.get("window").height;
/** The native map reports that it has its size and can move its camera. */
const mapReady = () =>
  fireEvent(screen.getByTestId("tracking-map"), "mapReady");

beforeEach(() => {
  resetMaps();
});

describe("mapScene — one car, one line, one pin per phase", () => {
  it("MP1: scheduled: the car is parked at its start, no line, the pin at pickup", () => {
    const snapshot = scheduledAt();

    expect(snapshot.phase).toBe("scheduled");
    expect(mapScene(scheduledRide, snapshot)).toEqual({
      car: scheduledRide.driverStart,
      line: null,
      pin: scheduledRide.pickup,
    });
  });

  it("MP2: en_route: the moving car, a line from the car to pickup, the pin at pickup", () => {
    const snapshot = enRouteAt();

    expect(snapshot.phase).toBe("en_route");
    expect(snapshot.car).not.toEqual(rideNow.driverStart);
    expect(snapshot.car).not.toEqual(rideNow.pickup);
    expect(mapScene(rideNow, snapshot)).toEqual({
      car: snapshot.car,
      line: [snapshot.car, rideNow.pickup],
      pin: rideNow.pickup,
    });
  });

  it("MP2: arrived: the car at pickup, a line from the car to pickup, the pin at pickup", () => {
    const snapshot = arrivedAt();

    expect(snapshot.phase).toBe("arrived");
    expect(mapScene(rideNow, snapshot)).toEqual({
      car: rideNow.pickup,
      line: [rideNow.pickup, rideNow.pickup],
      pin: rideNow.pickup,
    });
  });

  it("MP3: on_trip: the moving car, a line from the car to the destination, the pin at the destination", () => {
    const snapshot = onTripAt();

    expect(snapshot.phase).toBe("on_trip");
    expect(snapshot.car).not.toEqual(rideNow.pickup);
    expect(snapshot.car).not.toEqual(rideNow.destination);
    expect(mapScene(rideNow, snapshot)).toEqual({
      car: snapshot.car,
      line: [snapshot.car, rideNow.destination],
      pin: rideNow.destination,
    });
  });

  it("MP4: completed: no car, no line, the pin at the destination", () => {
    const snapshot = completedAt();

    expect(snapshot.phase).toBe("completed");
    expect(mapScene(rideNow, snapshot)).toEqual({
      car: null,
      line: null,
      pin: rideNow.destination,
    });
  });

  it("MP1 T8: cancelled: the car is parked at its start, no line, the pin at pickup", () => {
    const snapshot = cancelledAt();

    expect(snapshot.phase).toBe("cancelled");
    expect(mapScene(cancelledRide, snapshot)).toEqual({
      car: cancelledRide.driverStart,
      line: null,
      pin: cancelledRide.pickup,
    });
  });
});

describe("TrackingMap — rendered through the maps mock", () => {
  it.each([
    ["scheduled", true, false, scheduledRide, scheduledAt],
    ["en_route", true, true, rideNow, enRouteAt],
    ["arrived", true, true, rideNow, arrivedAt],
    ["on_trip", true, true, rideNow, onTripAt],
    ["completed", false, false, rideNow, completedAt],
    ["cancelled", true, false, cancelledRide, cancelledAt],
  ] as const)(
    "MP1 MP2 MP3 MP4: %s: tracking-car %p, tracking-route %p, tracking-pin always, each where mapScene puts it",
    (_, hasCar, hasRoute, tracked, at) => {
      const snapshot = at();
      const scene = mapScene(tracked, snapshot);
      render(<TrackingMap ride={tracked} snapshot={snapshot} />);

      expect(screen.getByTestId("tracking-pin")).toHaveProp(
        "coordinate",
        scene.pin,
      );
      expect(screen.getByTestId("tracking-pin")).toHaveProp("image", icons.pin);
      if (hasCar) {
        expect(screen.getByTestId("tracking-car")).toHaveProp(
          "coordinate",
          scene.car,
        );
      } else {
        expect(screen.queryByTestId("tracking-car")).toBeNull();
      }
      if (hasRoute) {
        expect(screen.getByTestId("tracking-route")).toHaveProp(
          "coordinates",
          scene.line,
        );
      } else {
        expect(screen.queryByTestId("tracking-route")).toBeNull();
      }
    },
  );

  it("MP2 MP3: draws the route line in primary-500, the tailwind.config.js token", () => {
    render(<TrackingMap ride={rideNow} snapshot={enRouteAt()} />);

    expect(screen.getByTestId("tracking-route")).toHaveProp(
      "strokeColor",
      colors.primary["500"],
    );
    expect(screen.getByTestId("tracking-route")).toHaveProp("strokeWidth", 3);
  });

  it("never shows the rider's own location, and first frames the pin and the driver's start", () => {
    render(<TrackingMap ride={rideNow} snapshot={enRouteAt()} />);

    const map = screen.getByTestId("tracking-map");
    expect(map).toHaveProp("showsUserLocation", false);
    expect(map).toHaveProp(
      "initialRegion",
      regionFor([rideNow.pickup, rideNow.driverStart], { padding: 1.8 }),
    );
  });

  it("turns the car by rotating its child image to the snapshot's heading", () => {
    const snapshot = enRouteAt();
    render(<TrackingMap ride={rideNow} snapshot={snapshot} />);

    const car = screen.getByTestId("tracking-car");
    const rotated = within(car)
      .UNSAFE_getAllByType(View)
      .filter((view) => StyleSheet.flatten(view.props.style)?.transform);
    expect(Number.isFinite(snapshot.headingDeg)).toBe(true);
    expect(rotated).toHaveLength(1);
    expect(StyleSheet.flatten(rotated[0].props.style).transform).toEqual([
      { rotate: `${snapshot.headingDeg}deg` },
    ]);
    expect(within(car).UNSAFE_getByType(Image).props.source).toBe(icons.marker);
  });

  it("R51: the camera refits on a phase change, not on every tick within a phase", () => {
    const first = enRouteAt(1);
    const { rerender } = render(
      <TrackingMap ride={rideNow} snapshot={first} coveredBottom={0.45} />,
    );
    mapReady();
    expect(fitToCoordinates).toHaveBeenCalledTimes(1);
    fitToCoordinates.mockClear();

    const tick = enRouteAt(3);
    rerender(
      <TrackingMap ride={rideNow} snapshot={tick} coveredBottom={0.45} />,
    );

    expect(tick.car).not.toEqual(first.car);
    expect(screen.getByTestId("tracking-car")).toHaveProp(
      "coordinate",
      tick.car,
    );
    expect(fitToCoordinates).not.toHaveBeenCalled();

    const onTrip = onTripAt();
    rerender(
      <TrackingMap ride={rideNow} snapshot={onTrip} coveredBottom={0.45} />,
    );

    expect(fitToCoordinates.mock.calls).toEqual([
      [
        regionCorners([rideNow.destination, onTrip.car]),
        { edgePadding: frameInsets(HEIGHT, 0.45), animated: true },
      ],
    ]);
    expect(animateToRegion).not.toHaveBeenCalled();
  });

  it("R51: once the ride completes, the camera frames the destination alone", () => {
    const { rerender } = render(
      <TrackingMap ride={rideNow} snapshot={onTripAt()} coveredBottom={0.45} />,
    );
    mapReady();
    fitToCoordinates.mockClear();

    rerender(
      <TrackingMap
        ride={rideNow}
        snapshot={completedAt()}
        coveredBottom={0.45}
      />,
    );

    expect(fitToCoordinates.mock.calls).toEqual([
      [
        regionCorners([rideNow.destination]),
        { edgePadding: frameInsets(HEIGHT, 0.45), animated: true },
      ],
    ]);
  });
});

describe("TrackingMap — MP7: framed where the sheet leaves the map clear", () => {
  it("MP7: the edges clear the header above and the sheet's share of the screen below, with a margin all round", () => {
    expect([HEADER_INSET_PX, FRAME_MARGIN_PX]).toEqual([112, 32]);
    expect(frameInsets(844, 0.45)).toEqual({
      top: 144,
      right: 32,
      bottom: 412, // 380 px of sheet (45% of 844) + the margin
      left: 32,
    });
    expect(frameInsets(844, 0)).toEqual({
      top: 144,
      right: 32,
      bottom: 32,
      left: 32,
    });
  });

  it.each([
    [
      "scheduled",
      scheduledRide,
      scheduledAt,
      (s: Snap) => [scheduledRide.pickup, scheduledRide.driverStart],
    ],
    ["en_route", rideNow, enRouteAt, (s: Snap) => [rideNow.pickup, s.car]],
    ["arrived", rideNow, arrivedAt, (s: Snap) => [rideNow.pickup, s.car]],
    ["on_trip", rideNow, onTripAt, (s: Snap) => [rideNow.destination, s.car]],
    ["completed", rideNow, completedAt, () => [rideNow.destination]],
    [
      "cancelled",
      cancelledRide,
      cancelledAt,
      () => [cancelledRide.pickup, cancelledRide.driverStart],
    ],
  ] as const)(
    "MP7: %s — once the map is ready it frames the car and its target above the 45%% sheet and below the header, at once",
    (_, tracked, at, framed) => {
      const snapshot = at();
      render(
        <TrackingMap ride={tracked} snapshot={snapshot} coveredBottom={0.45} />,
      );
      expect(fitToCoordinates).not.toHaveBeenCalled();

      mapReady();

      expect(fitToCoordinates.mock.calls).toEqual([
        [
          regionCorners([...framed(snapshot)]),
          {
            edgePadding: {
              top: 144,
              right: 32,
              bottom: Math.round(HEIGHT * 0.45) + 32,
              left: 32,
            },
            animated: false,
          },
        ],
      ]);
    },
  );

  it("MP7: a phase change before the map is ready moves no camera; the ready map frames the phase it is in", () => {
    const { rerender } = render(
      <TrackingMap
        ride={rideNow}
        snapshot={enRouteAt()}
        coveredBottom={0.45}
      />,
    );
    const onTrip = onTripAt();

    rerender(
      <TrackingMap ride={rideNow} snapshot={onTrip} coveredBottom={0.45} />,
    );
    expect(fitToCoordinates).not.toHaveBeenCalled();
    mapReady();

    expect(fitToCoordinates.mock.calls).toEqual([
      [
        regionCorners([rideNow.destination, onTrip.car]),
        { edgePadding: frameInsets(HEIGHT, 0.45), animated: false },
      ],
    ]);
  });

  it("MP7: without a sheet (coveredBottom left out) only the header is kept clear", () => {
    render(<TrackingMap ride={rideNow} snapshot={enRouteAt()} />);

    mapReady();

    expect(fitToCoordinates.mock.calls[0][1]).toEqual({
      edgePadding: { top: 144, right: 32, bottom: 32, left: 32 },
      animated: false,
    });
  });
});
