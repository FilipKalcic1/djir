/**
 * services/payment.ts — the Payment Sheet's confirm handler (P3–P9, K6).
 *
 * Kept free of React and of the Stripe module so every rule is unit-tested:
 *
 *  - P3b  the quote expired inside the sheet → re-quote once; the same fare
 *         books with the fresh token, a new fare fails with "Price updated…"
 *         (the sheet's amount cannot change once it is open).
 *  - P4   Android keeps the FIRST result for the whole sheet (stripe-react-
 *         native 0.37, PaymentSheetFragment's single CompletableDeferred), so
 *         later calls are ignored without touching the network, and every
 *         failure tells the rider to reopen the sheet (a decline: with another
 *         card), naming the button they will tap. iOS takes a new result per
 *         confirm, so retries there are safe.
 *  - P8   an unknown outcome (5xx, network error, `payment_unknown`) locks
 *         the sheet on both platforms: the rider must check Rides before
 *         paying again, so one tap can never become two charges. A failure
 *         the server marks `not_charged` (E3, E4) is known, not unknown: its
 *         message is shown and the rider may try again.
 *  - P4   only a card decline (402, or 400 `card_rejected`) suggests another
 *         card; any other 4xx (a bad quote, a driver gone) says "try again".
 *  - P9   once a booking succeeded, every later call gets that booking's client
 *         secret without booking again: a retry inside the sheet can never
 *         create a second PaymentIntent.
 *  - K6   the pickup slot is no longer bookable (`slot_unavailable`): the sheet
 *         says so, and Payment sends the rider back to the picker once it closes.
 *  - Every failure carries `localizedMessage` (the only field iOS shows).
 */

import { formatEur } from "@/lib/utils";
import { ApiError, apiErrorCode } from "@/services/api";
import { BookingResponse, sheetError } from "@/services/booking";
import { TripQuote } from "@/types/type";

/** P4: a decline on Android, where the sheet keeps its first answer. */
export const androidRetryHint = (buttonLabel: string) =>
  ` Close this sheet and tap ${buttonLabel} to try another card.`;
/** P4: any other failure on Android. */
export const androidTryAgainHint = (buttonLabel: string) =>
  ` Close this sheet and tap ${buttonLabel} to try again.`;
export const CHECK_RIDES_HINT =
  " Close this sheet and check Rides before booking again.";
export const UNKNOWN_OUTCOME_MESSAGE = `We couldn't confirm your payment.${CHECK_RIDES_HINT}`;
/** K6: no retry hint — the same slot can never book again. */
export const SLOT_UNAVAILABLE_MESSAGE =
  "That pickup time is no longer available. Close this sheet to choose a new time.";

type IntentCallback = (
  result: { clientSecret: string } | { error: ReturnType<typeof sheetError> },
) => void;

export interface ConfirmHandlerDeps {
  platform: string;
  quote: TripQuote;
  /** The button the rider taps to pay ("Confirm Ride" / "Schedule Ride"), named in Android's hints. */
  buttonLabel: string;
  book: (
    quoteToken: string,
    paymentMethodId: string,
  ) => Promise<BookingResponse>;
  requote: () => Promise<TripQuote>;
  onBooked: (rideId: number) => void;
  /** P8, with the ride the server may have charged when it says which (`payment_unknown` carries `ride_id`). */
  onOutcomeUnknown: (rideId: number | null) => void;
  onPriceChanged: () => void;
  /** K6: the server refused the pickup slot. */
  onSlotExpired: () => void;
}

const messageFor = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";

/** "Network request failed" → "Network request failed." so a hint reads as its own sentence. */
const sentence = (message: string) =>
  /[.!?]$/.test(message) ? message : `${message}.`;

/** The ride a `payment_unknown` answer names, if any. */
const rideIdOf = (error: unknown): number | null => {
  const rideId =
    error instanceof ApiError
      ? (error.body as { ride_id?: unknown } | null)?.ride_id
      : undefined;
  return typeof rideId === "number" && Number.isInteger(rideId) ? rideId : null;
};

/** A failure before any booking reached Stripe (the quote expired): nothing was charged. */
class NotCharged extends Error {}

/** The outcome may be a charge we cannot see (P8). */
function isUnknownOutcome(error: unknown) {
  if (error instanceof NotCharged) return false;
  if (!(error instanceof ApiError)) return true; // network error or timeout
  if (apiErrorCode(error) === "not_charged") return false; // E3, E4: the server knows
  return error.status >= 500 || apiErrorCode(error) === "payment_unknown";
}

/** P4: the card itself was refused (E1's 402, E2's `card_rejected`). */
const isCardDecline = (error: unknown) =>
  error instanceof ApiError &&
  (error.status === 402 || apiErrorCode(error) === "card_rejected");

export function makeConfirmHandler(deps: ConfirmHandlerDeps) {
  let calls = 0;
  let lockedMessage: string | null = null;
  let booked: BookingResponse | null = null;

  const bookWithFreshQuote = async (paymentMethodId: string) => {
    const fresh = await deps.requote().catch((error: unknown) => {
      if (apiErrorCode(error) === "slot_unavailable") throw error; // K6
      throw new NotCharged(messageFor(error));
    });
    if (fresh.fareCents !== deps.quote.fareCents) {
      deps.onPriceChanged();
      throw new NotCharged(
        `Price updated: ${formatEur(deps.quote.fareCents / 100)} → ${formatEur(fresh.fareCents / 100)}. Close this sheet and confirm again.`,
      );
    }
    return deps.book(fresh.token, paymentMethodId);
  };

  return async (
    paymentMethod: { id: string },
    _shouldSave: boolean,
    callback: IntentCallback,
  ): Promise<void> => {
    calls += 1;
    if (deps.platform === "android" && calls > 1) return; // P4: the first answer stands
    if (booked) {
      callback({ clientSecret: booked.client_secret }); // P9: never a second booking
      return;
    }
    if (lockedMessage) {
      callback({ error: sheetError(lockedMessage) }); // P8
      return;
    }

    try {
      let booking: BookingResponse;
      try {
        booking = await deps.book(deps.quote.token, paymentMethod.id);
      } catch (error) {
        if (apiErrorCode(error) !== "quote_expired") throw error;
        booking = await bookWithFreshQuote(paymentMethod.id); // P3b
      }
      booked = booking;
      deps.onBooked(booking.ride_id);
      callback({ clientSecret: booking.client_secret });
    } catch (error) {
      if (apiErrorCode(error) === "slot_unavailable") {
        deps.onSlotExpired(); // K6
        callback({ error: sheetError(SLOT_UNAVAILABLE_MESSAGE) });
        return;
      }
      if (isUnknownOutcome(error)) {
        lockedMessage = UNKNOWN_OUTCOME_MESSAGE;
        deps.onOutcomeUnknown(rideIdOf(error));
        callback({ error: sheetError(UNKNOWN_OUTCOME_MESSAGE) });
        return;
      }
      const message = sentence(messageFor(error));
      if (deps.platform !== "android" || message.includes("Close this sheet")) {
        callback({ error: sheetError(message) });
        return;
      }
      const hint = isCardDecline(error)
        ? androidRetryHint(deps.buttonLabel)
        : androidTryAgainHint(deps.buttonLabel);
      callback({ error: sheetError(message + hint) });
    }
  };
}
