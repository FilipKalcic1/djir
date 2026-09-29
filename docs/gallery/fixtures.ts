/**
 * Fixture data for the README renders (`npm run docs:shots`). Everything is
 * pinned to one instant, Thursday 1 Oct 2026 08:00 in Zagreb, so the renders
 * are the same on every run.
 *
 * Nothing on a render is typed in by hand: the drivers are the seed rows of
 * schema.sql, prices and trip minutes are what the app's fallback formula
 * (`heuristicQuote` in lib/pricing.ts) quotes for each trip at its booking
 * time, and pickup minutes are the ones the booking map gives each driver
 * (`generateMarkersFromData`).
 */
import { Asset } from "expo-asset";

import { distanceKm, LatLng } from "@/lib/geo";
import { generateMarkersFromData } from "@/lib/map";
import { heuristicQuote } from "@/lib/pricing";
import {
  phaseAt,
  simulatedPosition,
  straightLegs,
  timelineFor,
  TrackedRide,
  trackedRideFrom,
  TrackingSnapshot,
} from "@/lib/tracking";
import { useBookingStore, useDriverStore, useLocationStore } from "@/store";
import { Driver, Ride, TripQuote } from "@/types/type";

/**
 * The car on every driver card: the blue sedan from the app's own onboarding
 * artwork (assets/images/onboarding2.png), cut out with a transparent
 * background. The seed database still points at placeholder photos.
 */
const CAR_IMAGE_URL = Asset.fromModule(require("./car.png")).uri;

export const NOW = Date.parse("2026-10-01T06:00:00Z");
const MIN = 60_000;

/** The pickup the rider schedules on the renders: today, 09:00 (rush hour). */
export const PICKUP_AT = Date.parse("2026-10-01T07:00:00Z");

/** The seed drivers of schema.sql, as GET /driver returns them. */
export const drivers: Driver[] = [
  ["James", "Wilson", "men/32", "Sedan", 4, "4.80"],
  ["David", "Brown", "men/45", "SUV", 6, "4.60"],
  ["Michael", "Johnson", "men/12", "Hatch", 4, "4.90"],
  ["Robert", "Garcia", "men/76", "Van", 7, "4.50"],
  ["Daniel", "Martinez", "men/8", "Coupe", 2, "4.70"],
].map(([first_name, last_name, portrait, , car_seats, rating], i) => ({
  id: i + 1,
  first_name: first_name as string,
  last_name: last_name as string,
  profile_image_url: `https://randomuser.me/api/portraits/${portrait}.jpg`,
  car_image_url: CAR_IMAGE_URL,
  car_seats: car_seats as number,
  rating: rating as string,
}));

/** Tresnjevka → Donji grad is the chart's trip. */
const PICKUP: LatLng = { latitude: 45.8, longitude: 15.945 };
const DONJI_GRAD: LatLng = { latitude: 45.8085, longitude: 15.9775 };
const AIRPORT: LatLng = { latitude: 45.743, longitude: 16.069 };

export const markers = generateMarkersFromData({
  data: drivers,
  pickup: PICKUP,
});
/** The driver the rider picks on every render. */
const michael = markers.find((m) => m.first_name === "Michael")!;

/** What the server quotes for PICKUP → `to` at `whenMs` with no model endpoint. */
export function quoteFor(to: LatLng, whenMs: number) {
  const quote = heuristicQuote(distanceKm(PICKUP, to), whenMs);
  return {
    ...quote,
    fareCents: Math.round(quote.totalFareEur * 100),
    tripMinutes: Math.max(1, Math.ceil(quote.etaMinutes)), // ETAs round up
  };
}

/** A paid ride with Michael from PICKUP to `to`, quoted at `quotedAtMs`. */
function ride(
  to: LatLng,
  quotedAtMs: number,
  overrides: Partial<Ride> & Pick<Ride, "ride_id" | "destination_address">,
): Ride {
  const quote = quoteFor(to, quotedAtMs);
  return {
    origin_address: "Tresnjevka, Zagreb",
    origin_latitude: PICKUP.latitude,
    origin_longitude: PICKUP.longitude,
    destination_latitude: to.latitude,
    destination_longitude: to.longitude,
    ride_time: quote.tripMinutes,
    pickup_minutes: michael.pickupMinutes,
    fare_price: quote.totalFareEur,
    payment_status: "paid",
    created_at: new Date(quotedAtMs + MIN).toISOString(),
    paid_at: new Date(quotedAtMs + 2 * MIN).toISOString(),
    scheduled_at: null,
    cancelled_at: null,
    driver: {
      driver_id: michael.id,
      first_name: michael.first_name,
      last_name: michael.last_name,
      profile_image_url: michael.profile_image_url,
      car_image_url: michael.car_image_url,
      car_seats: michael.car_seats,
      rating: Number(michael.rating),
    },
    ...overrides,
  };
}

/** Booked for now, paid 2 minutes ago: Michael is on his way. */
export const live = ride(DONJI_GRAD, NOW - 4 * MIN, {
  ride_id: 41,
  destination_address: "Trg bana Jelačića, Zagreb",
});
/** Today 09:00 to the airport, booked at the rush-hour price. */
export const upcoming = ride(AIRPORT, PICKUP_AT, {
  ride_id: 43,
  destination_address: "Zagreb Airport, Velika Gorica",
  created_at: new Date(NOW - 20 * MIN).toISOString(),
  paid_at: new Date(NOW - 19 * MIN).toISOString(),
  scheduled_at: new Date(PICKUP_AT).toISOString(),
});
/** Sunday 17:30, cancelled the day after booking: refunded. */
const SUNDAY_1730 = Date.parse("2026-10-04T15:30:00Z");
export const cancelled = ride(DONJI_GRAD, SUNDAY_1730, {
  ride_id: 40,
  destination_address: "Trg bana Jelačića, Zagreb",
  created_at: "2026-09-29T17:10:00.000Z",
  paid_at: "2026-09-29T17:11:00.000Z",
  scheduled_at: new Date(SUNDAY_1730).toISOString(),
  cancelled_at: "2026-09-30T09:02:00.000Z",
  payment_status: "refunded",
});

/**
 * Instants in `live`'s drive (Michael sets off at its paid_at): arrived half a
 * minute after reaching the pickup, and on the trip 5 minutes after boarding.
 */
const setOff = Date.parse(live.paid_at!);
export const ARRIVED_AT = setOff + (michael.pickupMinutes + 0.5) * MIN;
export const ON_TRIP_AT = setOff + (michael.pickupMinutes + 1 + 5) * MIN;

/**
 * The README hero's animation: `live` from the moment Michael sets off to the
 * end of the trip, as instants to render (`?at=` epoch ms) and how long each
 * shows. Arriving now, the arrival and the end hold a little longer.
 */
const PICKUP_LEG = michael.pickupMinutes;
const TRIP = live.ride_time;
const BOARDED = PICKUP_LEG + 1;
export const HERO_FRAMES = [
  ...[0.03, 0.2, 0.4, 0.6, 0.85].map((f) => [f * PICKUP_LEG, 700]),
  [PICKUP_LEG - 0.4, 1000], // "Arriving now"
  [PICKUP_LEG + 0.5, 1600], // "Your driver has arrived"
  ...[0.05, 0.25, 0.45, 0.65, 0.85].map((f) => [BOARDED + f * TRIP, 700]),
  [BOARDED + TRIP - 0.5, 1000], // "1 Min to destination"
  [BOARDED + TRIP + 0.5, 2400], // "Ride complete"
].map(([minutes, ms]) => ({ query: `at=${setOff + minutes * MIN}`, ms }));

/** The ride as track-ride.tsx sees it at `nowMs`: tracked, and where the car is. */
export function trackingAt(
  r: Ride,
  nowMs: number,
): { tracked: TrackedRide; snapshot: TrackingSnapshot } {
  const tracked = trackedRideFrom(r)!;
  const snapshot = simulatedPosition()(tracked, straightLegs(tracked), nowMs);
  return { tracked, snapshot };
}

/** The TrackingSheet state for `r` at `nowMs`. */
export function sheetState(r: Ride, nowMs = NOW) {
  const timeline = timelineFor(r)!;
  return {
    kind: "ride" as const,
    ride: r,
    timeline,
    phase: phaseAt(timeline, nowMs),
    nowMs,
  };
}

/** The signed quote the booking screens hold for `upcoming` (the token is a stand-in). */
const airport = quoteFor(AIRPORT, PICKUP_AT);
export const bookedQuote: TripQuote = {
  token: "fixture",
  fareCents: airport.fareCents,
  tripMinutes: airport.tripMinutes,
  surgeMultiplier: airport.surgeMultiplier,
  source: airport.source,
  scheduledAt: PICKUP_AT,
  issuedAtMs: NOW,
};

/**
 * The stores as the booking flow leaves them for `upcoming`: Tresnjevka to the
 * airport, today 09:00, Michael chosen and priced. Find ride and Book Ride read
 * only these, so the renders can show the real screens.
 */
export function seedBookingFlow() {
  useLocationStore.setState({
    userLatitude: PICKUP.latitude,
    userLongitude: PICKUP.longitude,
    userAddress: upcoming.origin_address,
    destinationLatitude: AIRPORT.latitude,
    destinationLongitude: AIRPORT.longitude,
    destinationAddress: upcoming.destination_address,
  });
  useDriverStore.setState({
    drivers: markers,
    selectedDriver: michael.id,
    quote: bookedQuote,
    quoteStatus: "ready",
  });
  useBookingStore.setState({ scheduledAt: PICKUP_AT, slotNotice: null });
}
