/**
 * lib/map.ts — where drivers are, and what the map should frame.
 *
 * Djir has no driver app, so driver positions are simulated — but
 * deterministically: `driverStartFor` places a driver at the same spot relative
 * to a pickup every time it is called. The booking map, the server (which
 * stores the pickup ETA at booking) and the live tracker all use it, so the car
 * you pick is exactly the car you track (review R12).
 */

import { destinationPoint, LatLng } from "@/lib/geo";
import { pickupMinutesFor } from "@/lib/pricing";
import { Driver, MarkerData } from "@/types/type";

/** Central Zagreb, the service area: what an empty map frames. */
export const ZAGREB_CENTER: LatLng = { latitude: 45.815, longitude: 15.9819 };

/** Drivers wait 1.5–4 km from the rider: 4–10 min away at 25 km/h. */
export const DRIVER_RING_KM = { min: 1.5, max: 4 } as const;

/** Two reproducible numbers in [0, 1) from an integer seed (mulberry32). */
function seededPair(seed: number): [number, number] {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [next(), next()];
}

/** Where driver `driverId` starts relative to `pickup` — stable across calls. */
export function driverStartFor(driverId: number, pickup: LatLng): LatLng {
  const [u, v] = seededPair(Math.imul(driverId, 2654435761));
  const distanceKm =
    DRIVER_RING_KM.min + (DRIVER_RING_KM.max - DRIVER_RING_KM.min) * v;
  return destinationPoint(pickup, 360 * u, distanceKm);
}

/**
 * The booking map's driver markers: each driver at its seeded start around
 * `pickup` (driverStartFor), titled with its name and with the minutes it
 * needs to reach the rider (the minutes the DriverCard shows, R14).
 */
export function generateMarkersFromData({
  data,
  pickup,
}: {
  data: Driver[];
  pickup: LatLng;
}): MarkerData[] {
  return data.map((driver) => {
    const start = driverStartFor(driver.id, pickup);
    return {
      ...driver,
      ...start,
      title: `${driver.first_name} ${driver.last_name}`,
      pickupMinutes: pickupMinutesFor(start, pickup),
    };
  });
}

/** A map region: a centre and the span it shows, in degrees. */
export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * A region showing every point with some padding, never narrower than
 * `minDelta` (so pickup == destination still frames a street, R43). With no
 * points it frames central Zagreb, the service area.
 */
export function regionFor(
  points: LatLng[],
  { padding = 1.3, minDelta = 0.02 } = {},
): Region {
  if (points.length === 0) {
    return { ...ZAGREB_CENTER, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  }
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(minDelta, (maxLat - minLat) * padding),
    longitudeDelta: Math.max(minDelta, (maxLng - minLng) * padding),
  };
}

/**
 * The south-west and north-east corners of `regionFor(points, options)`: what
 * a camera fit (`fitToCoordinates`) needs to frame that same area, its
 * `minDelta` included, so a lone point or a car at its pickup still frames a
 * street rather than the map's closest zoom.
 */
export function regionCorners(
  points: LatLng[],
  options?: { padding?: number; minDelta?: number },
): [LatLng, LatLng] {
  const r = regionFor(points, options);
  return [
    {
      latitude: r.latitude - r.latitudeDelta / 2,
      longitude: r.longitude - r.longitudeDelta / 2,
    },
    {
      latitude: r.latitude + r.latitudeDelta / 2,
      longitude: r.longitude + r.longitudeDelta / 2,
    },
  ];
}
