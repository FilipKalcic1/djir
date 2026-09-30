import {
  bearingDeg,
  destinationPoint,
  distanceKm,
  pointAlong,
  polylineLengthKm,
} from "@/lib/geo";
import {
  DRIVER_RING_KM,
  driverStartFor,
  generateMarkersFromData,
  regionCorners,
  regionFor,
  ZAGREB_CENTER,
} from "@/lib/map";
import {
  clerkErrorMessage,
  displayName,
  formatEur,
  formatMinutes,
  NETWORK_ERROR_MESSAGE,
  placeName,
  signUpParams,
} from "@/lib/utils";
import { Driver } from "@/types/type";

const pickup = { latitude: 45.8, longitude: 15.945 };

describe("driverStartFor — seeded, stable driver positions (R12)", () => {
  it("R12: returns the same spot for the same driver every time", () => {
    expect(driverStartFor(3, pickup)).toEqual(driverStartFor(3, pickup));
  });

  it("R12: puts every driver 1.5–4 km from the pickup (4–10 min at 25 km/h)", () => {
    for (let id = 1; id <= 500; id++) {
      const km = distanceKm(driverStartFor(id, pickup), pickup);
      expect(km).toBeGreaterThanOrEqual(DRIVER_RING_KM.min - 1e-9);
      expect(km).toBeLessThanOrEqual(DRIVER_RING_KM.max + 1e-9);
    }
  });

  it("R12: does not depend on coordinate precision (the DB stores 7 decimals)", () => {
    const precise = { latitude: 45.81501234567, longitude: 15.98190123456 };
    const stored = {
      latitude: Number(precise.latitude.toFixed(7)),
      longitude: Number(precise.longitude.toFixed(7)),
    };
    expect(
      distanceKm(driverStartFor(3, precise), driverStartFor(3, stored)),
    ).toBeLessThan(0.001);
  });

  it("R12: spreads drivers around the pickup, not in one direction", () => {
    const bearings = [1, 2, 3, 4, 5, 6, 7, 8].map((id) =>
      Math.floor(bearingDeg(pickup, driverStartFor(id, pickup)) / 90),
    );
    expect(new Set(bearings).size).toBeGreaterThanOrEqual(3);
  });
});

describe("generateMarkersFromData", () => {
  it("places each driver with a title, keeping its fields", () => {
    const driver: Driver = {
      id: 3,
      first_name: "Michael",
      last_name: "Johnson",
      profile_image_url: null,
      car_image_url: null,
      car_seats: 4,
      rating: "4.9",
    };
    const [marker] = generateMarkersFromData({ data: [driver], pickup });
    expect(marker).toMatchObject({ ...driver, title: "Michael Johnson" });
    expect({ latitude: marker.latitude, longitude: marker.longitude }).toEqual(
      driverStartFor(3, pickup),
    );
  });
});

describe("regionFor (R43)", () => {
  it("R43: frames central Zagreb when there is nothing to show", () => {
    expect(regionFor([])).toMatchObject(ZAGREB_CENTER);
  });

  it("R43: never collapses to a zero span", () => {
    expect(regionFor([pickup, pickup])).toMatchObject({
      ...pickup,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  });

  it("R43: centres on and pads around all points", () => {
    const r = regionFor([
      { latitude: 45.7, longitude: 15.9 },
      { latitude: 45.9, longitude: 16.1 },
    ]);
    expect(r.latitude).toBeCloseTo(45.8);
    expect(r.longitude).toBeCloseTo(16.0);
    expect(r.latitudeDelta).toBeCloseTo(0.26);
  });
});

describe("regionCorners (MP7: what the native tracker's camera fits)", () => {
  it("MP7: gives the south-west and north-east corners of regionFor's area", () => {
    const points = [
      { latitude: 45.8, longitude: 15.94 },
      { latitude: 45.83, longitude: 15.98 },
    ];
    const r = regionFor(points, { padding: 1.3 });

    const [sw, ne] = regionCorners(points, { padding: 1.3 });

    expect(sw.latitude).toBeCloseTo(45.8 - 0.03 * 0.15, 12);
    expect(sw.longitude).toBeCloseTo(15.94 - 0.04 * 0.15, 12);
    expect(ne.latitude).toBeCloseTo(45.83 + 0.03 * 0.15, 12);
    expect(ne.longitude).toBeCloseTo(15.98 + 0.04 * 0.15, 12);
    expect((sw.latitude + ne.latitude) / 2).toBeCloseTo(r.latitude, 12);
    expect(ne.longitude - sw.longitude).toBeCloseTo(r.longitudeDelta, 12);
  });

  it("MP7: a lone point (a car at its pickup) still spans minDelta, never a single spot", () => {
    const [sw, ne] = regionCorners([pickup]);

    expect(sw).toEqual({
      latitude: pickup.latitude - 0.01,
      longitude: pickup.longitude - 0.01,
    });
    expect(ne).toEqual({
      latitude: pickup.latitude + 0.01,
      longitude: pickup.longitude + 0.01,
    });
  });
});

describe("geo", () => {
  it("destinationPoint lands the requested distance away, on the bearing", () => {
    const p = destinationPoint(pickup, 90, 2);
    expect(distanceKm(pickup, p)).toBeCloseTo(2, 6);
    expect(bearingDeg(pickup, p)).toBeCloseTo(90, 1);
  });

  it("pointAlong walks by distance and skips repeated points", () => {
    const route = [
      pickup,
      pickup,
      destinationPoint(pickup, 0, 1),
      destinationPoint(pickup, 0, 3),
    ];
    expect(polylineLengthKm(route)).toBeCloseTo(3);
    const half = pointAlong(route, 0.5);
    expect(distanceKm(pickup, half.point)).toBeCloseTo(1.5, 3);
    expect(half.headingDeg).toBeCloseTo(0, 3);
  });

  it("pointAlong clamps the fraction and handles one point", () => {
    const route = [pickup, destinationPoint(pickup, 90, 1)];
    expect(pointAlong(route, -1).point).toEqual(pickup);
    expect(pointAlong(route, 2).point).toEqual(route[1]);
    expect(pointAlong([pickup], 0.5)).toEqual({ point: pickup, headingDeg: 0 });
    expect(() => pointAlong([], 0)).toThrow("at least one point");
  });

  it("pointAlong parks exactly on the last point at fraction 1, even when the legs do not sum exactly", () => {
    // In floating point these two legs sum to a hair more than walking them.
    const route = [
      { latitude: 45.79, longitude: 15.945 },
      { latitude: 45.79, longitude: 15.95 },
      { latitude: 45.79, longitude: 15.96 },
    ];
    expect(pointAlong(route, 1)).toEqual({
      point: route[2],
      headingDeg: bearingDeg(route[1], route[2]),
    });
  });
});

describe("formatMinutes (R41)", () => {
  it.each([
    [12.4, "13 min"], // ETAs round up
    [12, "12 min"],
    [59.6, "1h 0m"],
    [65, "1h 5m"],
    [undefined, "—"],
    [null, "—"],
    [NaN, "—"],
  ])("R41: %p → %s", (minutes, text) => {
    expect(formatMinutes(minutes as number)).toBe(text);
  });
});

describe("placeName", () => {
  it.each([
    ["Trg bana Jelačića, Zagreb", "Trg bana Jelačića"],
    ["Ilica 1 , Zagreb, Croatia", "Ilica 1"],
    ["Zagreb Airport", "Zagreb Airport"],
  ])("S8 B1c R74: %p → %p", (address, name) => {
    expect(placeName(address)).toBe(name);
  });
});

it("formatEur shows cents", () => {
  expect(formatEur(9.7)).toBe("€9.70");
});

describe("clerkErrorMessage (R20)", () => {
  it.each([
    [
      { errors: [{ longMessage: "Password is incorrect." }] },
      "Password is incorrect.",
    ],
    [new Error("Too many requests."), "Too many requests."],
    [{ errors: [] }, "Try again"],
    [undefined, "Try again"],
    ["boom", "Try again"],
  ])("R20: %p → %s", (error, text) => {
    expect(clerkErrorMessage(error, "Try again")).toBe(text);
  });

  it.each([
    ["React Native's fetch", new TypeError("Network request failed")],
    [
      // @clerk/clerk-js 6 wraps it, naming Clerk's own endpoint (EG8).
      "Clerk",
      new Error(
        'ClerkJS: Network error at "https://clever-cat-12.clerk.accounts.dev/v1/client/sign_ins?__clerk_api_version=2026-05-12&_clerk_js_version=6.35.0&_is_native=1" - TypeError: Network request failed. Please try again.',
      ),
    ],
  ])(
    "R20: a connection that failed, as %s reports it, reads as one plain line instead",
    (_, error) => {
      expect(clerkErrorMessage(error, "Try again")).toBe(NETWORK_ERROR_MESSAGE);
      expect(NETWORK_ERROR_MESSAGE).toBe(
        "Couldn't connect. Check your internet connection and try again.",
      );
    },
  );
});

describe("displayName (R21)", () => {
  it.each([
    [{ firstName: "Ana" }, "Ana"],
    [{ firstName: null, unsafeMetadata: { name: "Ana Horvat" } }, "Ana"],
    [{ primaryEmailAddress: { emailAddress: "ana@example.com" } }, "ana"],
    [null, "there"],
  ])("R21: %p → %s", (user, name) => {
    expect(displayName(user as never)).toBe(name);
  });
});

describe("signUpParams (R21)", () => {
  it("R21: puts the trimmed name in unsafeMetadata, where displayName reads it back", () => {
    const params = signUpParams({
      name: "  Ana Horvat ",
      email: " ana@example.com ",
      password: " secret pw ",
    });
    expect(params).toEqual({
      emailAddress: "ana@example.com",
      password: " secret pw ",
      unsafeMetadata: { name: "Ana Horvat" },
    });
    expect(displayName({ unsafeMetadata: params.unsafeMetadata })).toBe("Ana");
  });

  it("R21: sends no metadata when the name is blank", () => {
    const params = signUpParams({
      name: "   ",
      email: "ana@example.com",
      password: "pw",
    });
    expect(params).toEqual({ emailAddress: "ana@example.com", password: "pw" });
    expect(params).not.toHaveProperty("unsafeMetadata");
  });
});
