/**
 * services/booking.ts — the booking API, as the app calls it.
 * Every call carries a fresh Clerk session token, read by fetchAPI, which
 * waits for it for TOKEN_TIMEOUT_MS at most (P8, X9, P7).
 */

import { fetchAPI } from "@/services/api";
import { Ride } from "@/types/type";

export type GetToken = () => Promise<string | null>;

export interface BookingRequest {
  quoteToken: string;
  driverId: number;
  paymentMethodId: string;
  originAddress: string;
  destinationAddress: string;
}

export interface BookingResponse {
  ride_id: number;
  client_secret: string;
  status: string;
}

export async function bookRide(
  request: BookingRequest,
  getToken: GetToken,
): Promise<BookingResponse> {
  return fetchAPI<BookingResponse>("/(api)/ride/book", {
    method: "POST",
    getToken,
    body: JSON.stringify({
      quote_token: request.quoteToken,
      driver_id: request.driverId,
      payment_method_id: request.paymentMethodId,
      origin_address: request.originAddress,
      destination_address: request.destinationAddress,
    }),
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mark a paid ride confirmed. Idempotent on the server, so it is safe to
 * retry a few times on a flaky network; if it still fails, GET /rides settles
 * the ride from Stripe later.
 */
export async function confirmRide(
  rideId: number,
  getToken: GetToken,
  { attempts = 3, backoffMs = 800 } = {},
): Promise<Ride> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { data } = await fetchAPI<{ data: Ride }>("/(api)/ride/confirm", {
        method: "POST",
        getToken,
        body: JSON.stringify({ ride_id: rideId }),
      });
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(backoffMs * (attempt + 1));
    }
  }
  throw lastError;
}

export async function cancelRide(
  rideId: number,
  getToken: GetToken,
): Promise<Ride> {
  const { data } = await fetchAPI<{ data: Ride }>("/(api)/ride/cancel", {
    method: "POST",
    getToken,
    body: JSON.stringify({ ride_id: rideId }),
  });
  return data;
}

/**
 * The error shape the Payment Sheet's confirm handler must return. iOS shows
 * only `localizedMessage`; without it the rider sees "An unknown error".
 */
export function sheetError(message: string) {
  return { code: "Failed" as const, message, localizedMessage: message };
}
