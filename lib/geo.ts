/**
 * lib/geo.ts — small, dependency-free geometry on WGS84 coordinates.
 *
 * `haversineKm` mirrors ml-platform/djir_ml/geo.py exactly (same radius, same
 * formula) because the pricing port depends on it. The polyline helpers power
 * live tracking: where along a route a car is, and which way it faces.
 */

/** A WGS84 coordinate, as react-native-maps takes it. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in km (mirror of djir_ml/geo.py). */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dPhi = toRad(lat2 - lat1);
  const dLmb = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLmb / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Great-circle distance in km between two coordinates (haversineKm on LatLngs). */
export function distanceKm(a: LatLng, b: LatLng): number {
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
}

/** Initial compass bearing from `from` to `to`: 0° = north, clockwise, in [0, 360). */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const phi1 = toRad(from.latitude);
  const phi2 = toRad(to.latitude);
  const dLmb = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLmb) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLmb);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `distanceKm` from `from` along compass `bearing` (great circle). */
export function destinationPoint(
  from: LatLng,
  bearing: number,
  distanceKm: number,
): LatLng {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearing);
  const phi1 = toRad(from.latitude);
  const lambda1 = toRad(from.longitude);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );
  return { latitude: toDeg(phi2), longitude: toDeg(lambda2) };
}

/** The length of a path in km: the sum of its segments (0 for fewer than two points). */
export function polylineLengthKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceKm(points[i - 1], points[i]);
  }
  return total;
}

/**
 * The point `fraction` (clamped to 0..1) of the way along `points`, measured
 * by distance, plus the heading of the segment it lies on. Zero-length
 * segments are skipped, so repeated points never produce a NaN heading.
 */
export function pointAlong(
  points: LatLng[],
  fraction: number,
): { point: LatLng; headingDeg: number } {
  if (points.length === 0) {
    throw new Error("pointAlong needs at least one point");
  }

  const segments: { from: LatLng; to: LatLng; lengthKm: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const lengthKm = distanceKm(points[i - 1], points[i]);
    if (lengthKm > 0) {
      segments.push({ from: points[i - 1], to: points[i], lengthKm });
    }
  }
  if (segments.length === 0) {
    return { point: points[0], headingDeg: 0 };
  }

  const totalKm = segments.reduce((sum, s) => sum + s.lengthKm, 0);
  let remainingKm = Math.min(1, Math.max(0, fraction)) * totalKm;

  for (const segment of segments) {
    if (remainingKm <= segment.lengthKm) {
      const t = remainingKm / segment.lengthKm;
      return {
        point: {
          latitude:
            segment.from.latitude +
            (segment.to.latitude - segment.from.latitude) * t,
          longitude:
            segment.from.longitude +
            (segment.to.longitude - segment.from.longitude) * t,
        },
        headingDeg: bearingDeg(segment.from, segment.to),
      };
    }
    remainingKm -= segment.lengthKm;
  }

  // Floating-point slack at fraction = 1: park on the final point.
  const last = segments[segments.length - 1];
  return { point: last.to, headingDeg: bearingDeg(last.from, last.to) };
}
