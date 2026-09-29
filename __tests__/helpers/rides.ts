import { Ride } from "@/types/type";

/** A paid ride now (Tresnjevka → Donji grad), booked at `createdAt`. */
export function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    ride_id: 1,
    origin_address: "Tresnjevka, Zagreb",
    destination_address: "Trg bana Jelačića, Zagreb",
    origin_latitude: 45.8,
    origin_longitude: 15.945,
    destination_latitude: 45.8085,
    destination_longitude: 15.9775,
    ride_time: 12,
    pickup_minutes: 7,
    fare_price: 9.74,
    payment_status: "paid",
    created_at: "2026-10-03T18:59:00.000Z",
    paid_at: "2026-10-03T19:00:00.000Z",
    scheduled_at: null,
    cancelled_at: null,
    driver: {
      driver_id: 3,
      first_name: "Michael",
      last_name: "Johnson",
      profile_image_url: "https://example.com/michael.jpg",
      car_image_url: "https://example.com/hatch.png",
      car_seats: 4,
      rating: 4.9,
    },
    ...overrides,
  };
}

export const MIN = 60_000;
