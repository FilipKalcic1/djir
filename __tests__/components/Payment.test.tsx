/**
 * The "Confirm Ride" button, state by state (WP1 "Payment client states"
 * P1–P9, K6, R09/R16/R70/R71/R75, EG5/EG6). The Stripe mock runs the real
 * confirm handler from services/payment when the sheet is presented; only the
 * network calls (booking, quotes), Clerk, Stripe, deep links and navigation
 * are faked. expo-linking answers as it does in Expo Go.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { ActivityIndicator, Alert, Platform } from "react-native";

import Payment, {
  PAYMENTS_NOT_SET_UP,
  QUOTE_REFRESH_AFTER_MS,
} from "@/components/Payment";
import WebPayment from "@/components/Payment.web";
import { ApiError } from "@/services/api";
import { bookRide, BookingResponse, confirmRide } from "@/services/booking";
import {
  androidRetryHint,
  CHECK_RIDES_HINT,
  SLOT_UNAVAILABLE_MESSAGE,
} from "@/services/payment";
import { fetchQuote } from "@/services/quotes";
import { SLOT_EXPIRED_NOTICE, useBookingStore, useDriverStore } from "@/store";
import { TripQuote } from "@/types/type";

import { deferred } from "../helpers/async";
import { auth, resetClerk } from "../helpers/mocks/clerk";
import { resetRouter, router } from "../helpers/mocks/expo-router";
import {
  AFTER_HANDLER_ERRORS,
  handleURLCallback,
  initPaymentSheet,
  presentPaymentSheet,
  resetStripe,
  sheet,
} from "../helpers/mocks/stripe";
import { makeRide, MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));
jest.mock("@stripe/stripe-react-native", () =>
  require("../helpers/mocks/stripe"),
);
// Links as Expo Go makes them: the dev server's address, then /--/ and the path.
jest.mock("expo-linking", () => ({
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  createURL: jest.fn((path: string) => `exp://192.168.1.20:8081/--/${path}`),
}));
jest.mock("@/services/booking", () => ({
  ...jest.requireActual("@/services/booking"),
  bookRide: jest.fn(),
  confirmRide: jest.fn(),
}));
jest.mock("@/services/quotes", () => ({ fetchQuote: jest.fn() }));

const mockBookRide = jest.mocked(bookRide);
const mockConfirmRide = jest.mocked(confirmRide);
const mockFetchQuote = jest.mocked(fetchQuote);
const mockAddEventListener = jest.mocked(Linking.addEventListener);

const NOW = Date.parse("2026-10-03T19:00:00.000Z"); // 21:00 in Zagreb
const PICKUP = { latitude: 45.8, longitude: 15.945 };
const DROPOFF = { latitude: 45.8085, longitude: 15.9775 };
const BOOKED: BookingResponse = {
  ride_id: 42,
  client_secret: "pi_42_secret_abc",
  status: "requires_confirmation",
};
const RIDE = makeRide({ ride_id: 42 });

const quoteOf = (overrides: Partial<TripQuote> = {}): TripQuote => ({
  token: "quote-token-1",
  fareCents: 974,
  tripMinutes: 12,
  surgeMultiplier: 1,
  source: "model",
  scheduledAt: null,
  issuedAtMs: NOW - MIN,
  ...overrides,
});
const staleQuote = () => quoteOf({ issuedAtMs: NOW - QUOTE_REFRESH_AFTER_MS });

function renderPayment(quote = quoteOf()) {
  const props = {
    driverId: 3,
    quote,
    pickup: PICKUP,
    dropoff: DROPOFF,
    originAddress: "Tresnjevka, Zagreb",
    destinationAddress: "Trg bana Jelačića, Zagreb",
    onBooked: jest.fn(),
    onPaidUnconfirmed: jest.fn(),
  };
  const view = render(<Payment {...props} />);
  return {
    ...props,
    unmount: view.unmount,
    rerenderWith: (next: TripQuote) =>
      view.rerender(<Payment {...props} quote={next} />),
  };
}

const confirmButton = () => screen.getByTestId("payment-confirm");
const tapConfirm = () => fireEvent.press(confirmButton());
/** The attempt is over: the button offers itself again. */
const settled = () => waitFor(() => expect(confirmButton()).toBeEnabled());

const declined = () =>
  new ApiError("Your card was declined.", 402, {
    error: "Your card was declined.",
  });

const expired = () =>
  new ApiError("Price expired — refreshing", 409, { code: "quote_expired" });

const PAYMENT_UNKNOWN =
  "We couldn't confirm whether your payment went through. Check Rides before booking again.";
const paymentUnknown = (body: Record<string, unknown> = {}) =>
  new ApiError(PAYMENT_UNKNOWN, 502, {
    error: PAYMENT_UNKNOWN,
    code: "payment_unknown",
    ...body,
  });

const incomplete = () =>
  new ApiError("The payment has not completed", 409, {
    error: "The payment has not completed",
    code: "payment_incomplete",
  });

const PLATFORMS = ["ios", "android"] as const;
const SLOT = Date.parse("2026-10-04T06:00:00.000Z"); // Sunday 08:00 in Zagreb

let alert: jest.SpyInstance;

// Set on process.env itself: the client project reads EXPO_PUBLIC_* keys
// through expo/virtual/env, which holds that object.
const savedStripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const setStripeKey = (value: string | undefined) => {
  if (value === undefined)
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  else process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = value;
};
afterAll(() => setStripeKey(savedStripeKey));

beforeEach(() => {
  setStripeKey("pk_test_51NdjirPublishable");
  jest.useFakeTimers({ now: NOW });
  resetStripe();
  resetClerk();
  resetRouter();
  useDriverStore.getState().reset();
  useBookingStore.getState().reset();
  mockBookRide.mockReset().mockResolvedValue(BOOKED);
  mockConfirmRide.mockReset().mockResolvedValue(RIDE);
  mockFetchQuote.mockReset();
  mockAddEventListener.mockClear();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Payment — P1/P2: idle and in flight", () => {
  it("P1: a quote for now reads 'Confirm Ride' and can be tapped", () => {
    renderPayment();

    expect(confirmButton()).toHaveTextContent("Confirm Ride");
    expect(confirmButton()).toBeEnabled();
    expect(confirmButton()).toHaveStyle({
      backgroundColor: colors.primary["500"],
    });
  });

  it("P1: a scheduled quote reads 'Schedule Ride'", () => {
    renderPayment(
      quoteOf({ scheduledAt: Date.parse("2026-10-04T06:00:00.000Z") }),
    );

    expect(confirmButton()).toHaveTextContent("Schedule Ride");
    expect(screen.queryByText("Confirm Ride")).toBeNull();
  });

  it("P2/R16: while the booking is in flight the button is disabled with a spinner, and a second tap opens nothing", async () => {
    const booking = deferred<BookingResponse>();
    mockBookRide.mockReturnValueOnce(booking.promise);
    const { onBooked } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(mockBookRide).toHaveBeenCalledTimes(1));

    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toBeBusy();
    expect(
      within(confirmButton()).UNSAFE_getByType(ActivityIndicator),
    ).toBeTruthy();
    expect(within(confirmButton()).queryByText("Confirm Ride")).toBeNull();
    tapConfirm();
    expect(initPaymentSheet).toHaveBeenCalledTimes(1);

    await act(async () => booking.resolve(BOOKED));
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));
  });
});

describe("Payment — R71/R75: the sheet's set-up", () => {
  it("R71 EG6: the sheet is initialised for exactly quote.fareCents in eur, card only, returning to the running app's stripe-redirect link (Expo Go's exp://…/--/stripe-redirect)", async () => {
    renderPayment(quoteOf({ fareCents: 1337 }));

    tapConfirm();
    await waitFor(() => expect(presentPaymentSheet).toHaveBeenCalledTimes(1));

    expect(Linking.createURL).toHaveBeenCalledWith("stripe-redirect");
    expect(initPaymentSheet).toHaveBeenCalledTimes(1);
    expect(initPaymentSheet).toHaveBeenCalledWith({
      merchantDisplayName: "Djir",
      returnURL: "exp://192.168.1.20:8081/--/stripe-redirect",
      intentConfiguration: {
        mode: { amount: 1337, currencyCode: "eur" },
        paymentMethodTypes: ["card"],
        confirmHandler: expect.any(Function),
      },
    });
  });

  it("R71: initPaymentSheet runs before every presentPaymentSheet — two attempts, two inits", async () => {
    sheet.outcome = { canceled: true };
    renderPayment();
    tapConfirm();
    await waitFor(() => expect(presentPaymentSheet).toHaveBeenCalledTimes(1));
    await settled();

    tapConfirm();
    await waitFor(() => expect(presentPaymentSheet).toHaveBeenCalledTimes(2));

    const inits = initPaymentSheet.mock.invocationCallOrder;
    const presents = presentPaymentSheet.mock.invocationCallOrder;
    expect(inits).toHaveLength(2);
    expect(inits[0]).toBeLessThan(presents[0]);
    expect(presents[0]).toBeLessThan(inits[1]);
    expect(inits[1]).toBeLessThan(presents[1]);
  });

  it("R75: an init error alerts 'Payment unavailable' with its localizedMessage and never presents the sheet", async () => {
    initPaymentSheet.mockResolvedValueOnce({
      error: {
        code: "Failed",
        message: "PaymentConfiguration was not initialized",
        localizedMessage: "Payments are unavailable right now.",
      },
    });
    renderPayment();

    tapConfirm();
    await settled();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      "Payment unavailable",
      "Payments are unavailable right now.",
    );
    expect(presentPaymentSheet).not.toHaveBeenCalled();
    expect(mockBookRide).not.toHaveBeenCalled();
  });

  it("R75: an init error without a localizedMessage shows its message", async () => {
    initPaymentSheet.mockResolvedValueOnce({
      error: { code: "Failed", message: "No publishable key" },
    });
    renderPayment();

    tapConfirm();
    await settled();

    expect(alert).toHaveBeenCalledWith(
      "Payment unavailable",
      "No publishable key",
    );
    expect(presentPaymentSheet).not.toHaveBeenCalled();
  });
});

describe("Payment — P5 to P7: how the sheet ends", () => {
  it("P5: closing the sheet (Canceled) books nothing, shows nothing and re-enables the button", async () => {
    sheet.outcome = { canceled: true };
    const { onBooked, onPaidUnconfirmed } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(presentPaymentSheet).toHaveBeenCalledTimes(1));
    await settled();

    expect(alert).not.toHaveBeenCalled();
    expect(mockBookRide).not.toHaveBeenCalled();
    expect(mockConfirmRide).not.toHaveBeenCalled();
    expect(onBooked).not.toHaveBeenCalled();
    expect(onPaidUnconfirmed).not.toHaveBeenCalled();
    expect(confirmButton()).toHaveTextContent("Confirm Ride");
  });

  it("a sheet that closes without an error but without a booked ride confirms nothing and shows nothing", async () => {
    presentPaymentSheet.mockResolvedValueOnce({});
    const { onBooked } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(presentPaymentSheet).toHaveBeenCalledTimes(1));
    await settled();

    expect(alert).not.toHaveBeenCalled();
    expect(mockConfirmRide).not.toHaveBeenCalled();
    expect(onBooked).not.toHaveBeenCalled();
  });

  it("P6: a paid booking sends the signed quote, then is confirmed by ride id and handed to onBooked", async () => {
    const { onBooked, onPaidUnconfirmed } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(onBooked).toHaveBeenCalledTimes(1));

    expect(mockBookRide).toHaveBeenCalledWith(
      {
        quoteToken: "quote-token-1",
        driverId: 3,
        paymentMethodId: "pm_card_visa",
        originAddress: "Tresnjevka, Zagreb",
        destinationAddress: "Trg bana Jelačića, Zagreb",
      },
      auth.getToken,
    );
    expect(sheet.lastResult).toEqual({ clientSecret: "pi_42_secret_abc" });
    expect(mockConfirmRide).toHaveBeenCalledWith(42, auth.getToken);
    expect(onBooked).toHaveBeenCalledWith(RIDE);
    expect(onPaidUnconfirmed).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("R16: after a successful payment the button stays disabled, so the ride cannot be paid twice", async () => {
    const { onBooked } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(onBooked).toHaveBeenCalledTimes(1));

    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).not.toBeBusy();
    tapConfirm();
    expect(initPaymentSheet).toHaveBeenCalledTimes(1);
  });

  it("P7: paid but not confirmed calls onPaidUnconfirmed, not onBooked, and keeps the button disabled", async () => {
    mockConfirmRide.mockRejectedValueOnce(new Error("Network request failed"));
    const { onBooked, onPaidUnconfirmed } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(onPaidUnconfirmed).toHaveBeenCalledTimes(1));

    expect(mockConfirmRide).toHaveBeenCalledWith(42, auth.getToken);
    expect(onBooked).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    await waitFor(() => expect(confirmButton()).not.toBeBusy());
    expect(confirmButton()).toBeDisabled();
  });
});

describe("Payment — R09/P4: failures", () => {
  it("R09: a declined card alerts 'Payment failed' with the sheet's localizedMessage, then the button is offered again", async () => {
    mockBookRide.mockRejectedValueOnce(declined());
    const { onBooked } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    await settled();

    expect(alert).toHaveBeenCalledWith(
      "Payment failed",
      "Your card was declined.",
    );
    expect(sheet.lastResult).toEqual({
      error: {
        code: "Failed",
        message: "Your card was declined.",
        localizedMessage: "Your card was declined.",
      },
    });
    expect(mockConfirmRide).not.toHaveBeenCalled();
    expect(onBooked).not.toHaveBeenCalled();
  });

  it("R09: a sheet error without a localizedMessage alerts its message", async () => {
    presentPaymentSheet.mockResolvedValueOnce({
      error: { code: "Failed", message: "The card form timed out" },
    });
    renderPayment();

    tapConfirm();
    await settled();

    expect(alert).toHaveBeenCalledWith(
      "Payment failed",
      "The card form timed out",
    );
  });

  it("P4: on Android a 402 decline tells the rider to close the sheet and tap Confirm Ride, and later handler calls are ignored with no network", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockBookRide.mockRejectedValueOnce(declined());
    renderPayment();

    tapConfirm();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));

    const message = `Your card was declined.${androidRetryHint("Confirm Ride")}`;
    expect(message).toBe(
      "Your card was declined. Close this sheet and tap Confirm Ride to try another card.",
    );
    expect(sheet.lastResult).toEqual({
      error: { code: "Failed", message, localizedMessage: message },
    });
    expect(alert).toHaveBeenCalledWith("Payment failed", message);

    const retry = jest.fn();
    await act(async () => {
      await sheet.handler!({ id: "pm_card_mastercard" }, false, retry);
    });
    expect(mockBookRide).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("P4: on Android a scheduled ride's decline names the 'Schedule Ride' button that is on screen", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    mockBookRide.mockRejectedValueOnce(declined());
    renderPayment(quoteOf({ scheduledAt: SLOT }));

    tapConfirm();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));

    const message =
      "Your card was declined. Close this sheet and tap Schedule Ride to try another card.";
    expect(sheet.lastResult).toEqual({
      error: { code: "Failed", message, localizedMessage: message },
    });
    expect(alert).toHaveBeenCalledWith("Payment failed", message);
    expect(confirmButton()).toHaveTextContent("Schedule Ride");
  });

  it("P4: on iOS a decline carries no hint, and a retry inside the same sheet books again", async () => {
    mockBookRide.mockRejectedValueOnce(declined());
    renderPayment();

    tapConfirm();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert).toHaveBeenCalledWith(
      "Payment failed",
      "Your card was declined.",
    );

    const retry = jest.fn();
    await act(async () => {
      await sheet.handler!({ id: "pm_card_mastercard" }, false, retry);
    });
    expect(mockBookRide).toHaveBeenCalledTimes(2);
    expect(mockBookRide.mock.calls[1][0].paymentMethodId).toBe(
      "pm_card_mastercard",
    );
    expect(retry).toHaveBeenCalledWith({ clientSecret: "pi_42_secret_abc" });
  });
});

describe("Payment — P3: a stale quote is refreshed before the sheet", () => {
  it("P3: a quote just under 5 min old opens the sheet directly", async () => {
    renderPayment(quoteOf({ issuedAtMs: NOW - QUOTE_REFRESH_AFTER_MS + 1 }));

    tapConfirm();
    await waitFor(() => expect(presentPaymentSheet).toHaveBeenCalledTimes(1));

    expect(QUOTE_REFRESH_AFTER_MS).toBe(5 * MIN);
    expect(useDriverStore.getState().quoteRequest).toBe(0);
  });

  it("P3: a quote 5 min old asks the store for a new quote instead of opening the sheet", async () => {
    renderPayment(staleQuote());

    tapConfirm();
    await act(async () => {});

    expect(useDriverStore.getState().quoteRequest).toBe(1);
    expect(initPaymentSheet).not.toHaveBeenCalled();
    expect(presentPaymentSheet).not.toHaveBeenCalled();
    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toBeBusy();
  });

  it("P3: a fresh quote at the same fare continues to the sheet by itself, paying with the fresh token", async () => {
    const { rerenderWith, onBooked } = renderPayment(staleQuote());
    tapConfirm();

    rerenderWith(quoteOf({ token: "quote-token-2", issuedAtMs: NOW }));
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));

    expect(initPaymentSheet).toHaveBeenCalledTimes(1);
    expect(initPaymentSheet.mock.calls[0][0].intentConfiguration).toMatchObject(
      { mode: { amount: 974, currencyCode: "eur" } },
    );
    expect(mockBookRide.mock.calls[0][0].quoteToken).toBe("quote-token-2");
    expect(screen.queryByTestId("payment-price-updated")).toBeNull();
  });

  it("P3: a fresh quote at a different fare shows 'Price updated: €9.74 → €10.20' and opens nothing until a second tap", async () => {
    const { rerenderWith, onBooked } = renderPayment(staleQuote());
    tapConfirm();

    rerenderWith(
      quoteOf({ token: "quote-token-2", fareCents: 1020, issuedAtMs: NOW }),
    );
    await act(async () => {});

    const notice = screen.getByTestId("payment-price-updated");
    expect(notice).toHaveTextContent("Price updated: €9.74 → €10.20");
    expect(notice).toHaveStyle({ color: colors.warning["600"] });
    expect(initPaymentSheet).not.toHaveBeenCalled();
    expect(confirmButton()).toBeEnabled();

    tapConfirm();
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));

    expect(initPaymentSheet.mock.calls[0][0].intentConfiguration).toMatchObject(
      { mode: { amount: 1020, currencyCode: "eur" } },
    );
    expect(mockBookRide.mock.calls[0][0].quoteToken).toBe("quote-token-2");
    expect(screen.queryByTestId("payment-price-updated")).toBeNull();
  });

  it("P3: a refreshed quote that is itself stale keeps waiting", async () => {
    const { rerenderWith } = renderPayment(staleQuote());
    tapConfirm();

    rerenderWith(
      quoteOf({ token: "quote-token-2", issuedAtMs: NOW - 6 * MIN }),
    );
    await act(async () => {});

    expect(initPaymentSheet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("payment-price-updated")).toBeNull();
    expect(confirmButton()).toBeBusy();
  });

  it("P3: a new quote arriving without a tap opens nothing", async () => {
    const { rerenderWith } = renderPayment();

    rerenderWith(quoteOf({ token: "quote-token-2", issuedAtMs: NOW }));
    await act(async () => {});

    expect(initPaymentSheet).not.toHaveBeenCalled();
    expect(confirmButton()).toBeEnabled();
  });

  it("P3b: a quote that expires inside the sheet is re-quoted for the same trip and slot; a new fare books nothing and refreshes the store", async () => {
    const scheduledAt = Date.parse("2026-10-04T06:00:00.000Z");
    mockBookRide.mockRejectedValueOnce(expired());
    mockFetchQuote.mockResolvedValueOnce(
      quoteOf({ token: "quote-token-2", fareCents: 1020, scheduledAt }),
    );
    const { onBooked } = renderPayment(quoteOf({ scheduledAt }));

    tapConfirm();
    await waitFor(() => expect(presentPaymentSheet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sheet.lastResult).not.toBeNull());

    expect(mockFetchQuote).toHaveBeenCalledWith(PICKUP, DROPOFF, scheduledAt);
    expect(useDriverStore.getState().quoteRequest).toBe(1);
    expect(mockBookRide).toHaveBeenCalledTimes(1);
    expect(mockConfirmRide).not.toHaveBeenCalled();
    expect(onBooked).not.toHaveBeenCalled();
  });

  it("P3b: a quote re-quoted inside the sheet at the same fare books with the fresh token", async () => {
    mockBookRide.mockRejectedValueOnce(expired());
    mockFetchQuote.mockResolvedValueOnce(quoteOf({ token: "quote-token-2" }));
    const { onBooked } = renderPayment();

    tapConfirm();
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));

    expect(mockFetchQuote).toHaveBeenCalledWith(PICKUP, DROPOFF, null);
    expect(mockBookRide.mock.calls[1][0].quoteToken).toBe("quote-token-2");
    expect(useDriverStore.getState().quoteRequest).toBe(0);
  });
});

describe("Payment — P3c: the refresh before the sheet failed", () => {
  const refreshFails = (message: string | null) => {
    act(() => useDriverStore.getState().setQuote("loading"));
    act(() => useDriverStore.getState().setQuote("error", null, message));
  };

  it("P3c: a failed refresh says 'Couldn't refresh the price. <message>', opens no sheet and offers the button again", () => {
    renderPayment(staleQuote());
    tapConfirm();

    refreshFails("Couldn't get prices. Check your connection and try again.");

    const line = screen.getByTestId("payment-requote-error");
    expect(line).toHaveTextContent(
      "Couldn't refresh the price. Couldn't get prices. Check your connection and try again.",
    );
    expect(line).toHaveStyle({ color: colors.danger["700"] });
    expect(confirmButton()).toBeEnabled();
    expect(confirmButton()).not.toBeBusy();
    expect(confirmButton()).toHaveTextContent("Confirm Ride");
    expect(initPaymentSheet).not.toHaveBeenCalled();
    expect(presentPaymentSheet).not.toHaveBeenCalled();
  });

  it("P3c: a failure without a message still says the price couldn't be refreshed", () => {
    renderPayment(staleQuote());
    tapConfirm();

    refreshFails(null);

    expect(screen.getByTestId("payment-requote-error")).toHaveTextContent(
      /^Couldn't refresh the price\.$/,
    );
  });

  it("P3c: a tap retries — the error line goes, the store is asked again, and a fresh quote at the same fare pays", async () => {
    const { rerenderWith, onBooked } = renderPayment(staleQuote());
    tapConfirm();
    refreshFails("Network request failed");

    tapConfirm();

    expect(useDriverStore.getState().quoteRequest).toBe(2);
    expect(screen.queryByTestId("payment-requote-error")).toBeNull();
    expect(confirmButton()).toBeBusy();
    expect(initPaymentSheet).not.toHaveBeenCalled();

    rerenderWith(quoteOf({ token: "quote-token-2", issuedAtMs: NOW }));
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));
    expect(mockBookRide.mock.calls[0][0].quoteToken).toBe("quote-token-2");
  });

  it("P3c: a quote error while no tap is waiting for a refresh shows nothing here", () => {
    renderPayment();

    refreshFails("Network request failed");

    expect(screen.queryByTestId("payment-requote-error")).toBeNull();
    expect(confirmButton()).toBeEnabled();
  });
});

describe("Payment — K6: the slot went stale before booking", () => {
  const slotGone = () =>
    new ApiError("That pickup time is no longer available", 409, {
      error: "That pickup time is no longer available",
      code: "slot_unavailable",
    });

  it.each(PLATFORMS)(
    "K6: a booking answered 409 slot_unavailable is explained in the sheet; once it closes, the pickup time goes back to Now with the K5 notice and no alert (%s)",
    async (os) => {
      jest.replaceProperty(Platform, "OS", os);
      useBookingStore.setState({ scheduledAt: SLOT });
      mockBookRide.mockRejectedValueOnce(slotGone());
      const { onBooked, onPaidUnconfirmed } = renderPayment(
        quoteOf({ scheduledAt: SLOT }),
      );

      tapConfirm();
      await waitFor(() =>
        expect(useBookingStore.getState().slotNotice).not.toBeNull(),
      );
      await settled();

      expect(sheet.lastResult).toEqual({
        error: {
          code: "Failed",
          message: SLOT_UNAVAILABLE_MESSAGE,
          localizedMessage: SLOT_UNAVAILABLE_MESSAGE,
        },
      });
      expect(useBookingStore.getState()).toMatchObject({
        scheduledAt: null,
        slotNotice: SLOT_EXPIRED_NOTICE,
      });
      expect(alert).not.toHaveBeenCalled();
      expect(mockConfirmRide).not.toHaveBeenCalled();
      expect(onBooked).not.toHaveBeenCalled();
      expect(onPaidUnconfirmed).not.toHaveBeenCalled();
    },
  );

  it("K6: the pickup time is reset only after the sheet has closed", async () => {
    useBookingStore.setState({ scheduledAt: SLOT });
    mockBookRide.mockRejectedValueOnce(slotGone());
    let whileOpen: number | null | undefined;
    presentPaymentSheet.mockImplementationOnce(async () => {
      await new Promise((resolve) =>
        sheet.handler!({ id: "pm_card_visa" }, false, resolve),
      );
      whileOpen = useBookingStore.getState().scheduledAt;
      return { error: AFTER_HANDLER_ERRORS.Canceled };
    });
    renderPayment(quoteOf({ scheduledAt: SLOT }));

    tapConfirm();
    await settled();

    expect(whileOpen).toBe(SLOT);
    expect(useBookingStore.getState().scheduledAt).toBeNull();
  });
});

describe("Payment — P9: the sheet ended badly after the ride was booked", () => {
  it.each(PLATFORMS)(
    "P9: closed after booking, but the ride was paid — one confirmRide, then onBooked (P6) and the button stays off (%s)",
    async (os) => {
      jest.replaceProperty(Platform, "OS", os);
      sheet.outcome = {
        paymentMethodId: "pm_card_visa",
        afterHandler: "Canceled",
      };
      const { onBooked, onPaidUnconfirmed } = renderPayment();

      tapConfirm();
      await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));

      expect(sheet.lastResult).toEqual({ clientSecret: "pi_42_secret_abc" });
      expect(mockConfirmRide.mock.calls).toEqual([
        [42, auth.getToken, { attempts: 1 }],
      ]);
      expect(confirmButton()).toBeDisabled();
      expect(alert).not.toHaveBeenCalled();
      expect(onPaidUnconfirmed).not.toHaveBeenCalled();
    },
  );

  it.each(PLATFORMS)(
    "P9: closed after booking and not paid (409 payment_incomplete) — nothing shown, as P5, and the next tap is a new booking (%s)",
    async (os) => {
      jest.replaceProperty(Platform, "OS", os);
      sheet.outcome = {
        paymentMethodId: "pm_card_visa",
        afterHandler: "Canceled",
      };
      mockConfirmRide.mockRejectedValueOnce(incomplete());
      const { onBooked } = renderPayment();

      tapConfirm();
      await waitFor(() => expect(mockConfirmRide).toHaveBeenCalledTimes(1));
      await settled();

      expect(alert).not.toHaveBeenCalled();
      expect(onBooked).not.toHaveBeenCalled();
      expect(screen.queryByTestId("payment-unknown")).toBeNull();

      sheet.outcome = { paymentMethodId: "pm_card_visa" };
      tapConfirm();
      await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));
      expect(mockBookRide).toHaveBeenCalledTimes(2);
    },
  );

  it.each(PLATFORMS)(
    "P9: the sheet failed after booking and the payment is incomplete — 'Payment failed' with the sheet's message, as P4 (%s)",
    async (os) => {
      jest.replaceProperty(Platform, "OS", os);
      sheet.outcome = {
        paymentMethodId: "pm_card_visa",
        afterHandler: "Failed",
      };
      mockConfirmRide.mockRejectedValueOnce(incomplete());
      const { onBooked } = renderPayment();

      tapConfirm();
      await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
      await settled();

      expect(alert).toHaveBeenCalledWith(
        "Payment failed",
        AFTER_HANDLER_ERRORS.Failed.localizedMessage,
      );
      expect(mockConfirmRide.mock.calls).toEqual([
        [42, auth.getToken, { attempts: 1 }],
      ]);
      expect(onBooked).not.toHaveBeenCalled();
    },
  );

  it.each(PLATFORMS)(
    "P9: when that check itself fails, the outcome is unknown — the P8 view, no second payment, and one more check in the background (%s)",
    async (os) => {
      jest.replaceProperty(Platform, "OS", os);
      sheet.outcome = {
        paymentMethodId: "pm_card_visa",
        afterHandler: "Failed",
      };
      mockConfirmRide.mockRejectedValue(
        new TypeError("Network request failed"),
      );
      const { onBooked, onPaidUnconfirmed } = renderPayment();

      tapConfirm();
      await screen.findByTestId("payment-unknown");
      await waitFor(() => expect(mockConfirmRide).toHaveBeenCalledTimes(2));

      expect(mockConfirmRide.mock.calls).toEqual([
        [42, auth.getToken, { attempts: 1 }],
        [42, auth.getToken],
      ]);
      expect(screen.queryByTestId("payment-confirm")).toBeNull();
      expect(alert).not.toHaveBeenCalled();
      expect(onBooked).not.toHaveBeenCalled();
      expect(onPaidUnconfirmed).not.toHaveBeenCalled();
    },
  );
});

describe("Payment — P8: the outcome is unknown", () => {
  it("P8: a network error while booking shows 'We couldn't confirm…' with Check Rides and no Confirm button", async () => {
    mockBookRide.mockRejectedValueOnce(new TypeError("Network request failed"));
    const { onBooked, onPaidUnconfirmed } = renderPayment();

    tapConfirm();
    const unknown = await screen.findByTestId("payment-unknown");

    expect(
      within(unknown).getByText(
        "We couldn't confirm whether your payment went through.",
      ),
    ).toBeOnTheScreen();
    expect(
      within(unknown).getByRole("button", { name: "Check Rides" }),
    ).toBeEnabled();
    expect(screen.queryByTestId("payment-confirm")).toBeNull();
    expect(sheet.lastResult).toEqual({
      error: expect.objectContaining({
        localizedMessage: expect.stringContaining(CHECK_RIDES_HINT),
      }),
    });
    expect(mockConfirmRide).not.toHaveBeenCalled();
    expect(onBooked).not.toHaveBeenCalled();
    expect(onPaidUnconfirmed).not.toHaveBeenCalled();
  });

  it("P8: the P8 view explains itself — no 'Payment failed' alert is stacked on it", async () => {
    mockBookRide.mockRejectedValueOnce(new TypeError("Network request failed"));
    renderPayment();

    tapConfirm();
    await screen.findByTestId("payment-unknown");
    await act(async () => {
      await presentPaymentSheet.mock.results[0].value;
    });
    await act(async () => {});

    expect(alert).not.toHaveBeenCalled();
  });

  it("P8: a payment_unknown that names its ride asks confirmRide once in the background; paid → onBooked (P6)", async () => {
    mockBookRide.mockRejectedValueOnce(paymentUnknown({ ride_id: 42 }));
    const { onBooked, onPaidUnconfirmed } = renderPayment();

    tapConfirm();
    await screen.findByTestId("payment-unknown");
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(RIDE));

    expect(mockConfirmRide.mock.calls).toEqual([[42, auth.getToken]]);
    expect(onPaidUnconfirmed).not.toHaveBeenCalled();
  });

  it("P8: if that background check fails, the P8 view stays (Rides settles the ride later)", async () => {
    mockBookRide.mockRejectedValueOnce(paymentUnknown({ ride_id: 42 }));
    mockConfirmRide.mockRejectedValueOnce(incomplete());
    const { onBooked } = renderPayment();

    tapConfirm();
    await screen.findByTestId("payment-unknown");
    await waitFor(() => expect(mockConfirmRide).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(screen.getByTestId("payment-unknown")).toBeOnTheScreen();
    expect(onBooked).not.toHaveBeenCalled();
  });

  it("P8: a check that answers after the rider has left books nothing", async () => {
    const check = deferred<typeof RIDE>();
    mockConfirmRide.mockReturnValueOnce(check.promise);
    mockBookRide.mockRejectedValueOnce(paymentUnknown({ ride_id: 42 }));
    const { onBooked, unmount } = renderPayment();
    tapConfirm();
    await waitFor(() => expect(mockConfirmRide).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => check.resolve(RIDE));

    expect(onBooked).not.toHaveBeenCalled();
  });

  it("P8 E4: a 502 not_charged is no unknown outcome — no Check Rides view; the sheet gives the server's message and the button is offered again", async () => {
    const NOT_STARTED =
      "We couldn't start the payment, and nothing was charged. Please try again.";
    mockBookRide.mockRejectedValueOnce(
      new ApiError(NOT_STARTED, 502, {
        error: NOT_STARTED,
        code: "not_charged",
      }),
    );
    const { onBooked } = renderPayment();

    tapConfirm();
    await settled();

    expect(sheet.lastResult).toEqual({
      error: expect.objectContaining({ localizedMessage: NOT_STARTED }),
    });
    expect(screen.queryByTestId("payment-unknown")).toBeNull();
    expect(mockConfirmRide).not.toHaveBeenCalled();
    expect(onBooked).not.toHaveBeenCalled();
    expect(mockBookRide).toHaveBeenCalledTimes(1);
  });

  it("P8: Check Rides dismisses the booking stack, then opens the Rides tab", async () => {
    mockBookRide.mockRejectedValueOnce(new TypeError("Network request failed"));
    renderPayment();
    tapConfirm();
    await screen.findByTestId("payment-unknown");

    fireEvent.press(screen.getByRole("button", { name: "Check Rides" }));

    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith("/(root)/(tabs)/rides");
    expect(router.dismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      router.navigate.mock.invocationCallOrder[0],
    );
  });
});

describe("Payment — 3-D Secure return links", () => {
  const urlListener = () => {
    expect(mockAddEventListener).toHaveBeenCalledWith(
      "url",
      expect.any(Function),
    );
    return mockAddEventListener.mock.calls[0][1] as (event: {
      url: string;
    }) => void;
  };

  it("a djir://stripe-redirect link is handed to handleURLCallback", () => {
    renderPayment();

    const url = "djir://stripe-redirect?payment_intent=pi_42";
    act(() => urlListener()({ url }));

    expect(handleURLCallback).toHaveBeenCalledTimes(1);
    expect(handleURLCallback).toHaveBeenCalledWith(url);
  });

  it("EG6: Expo Go's own stripe-redirect link is handed to handleURLCallback too", () => {
    renderPayment();

    const url =
      "exp://192.168.1.20:8081/--/stripe-redirect?payment_intent=pi_42";
    act(() => urlListener()({ url }));

    expect(handleURLCallback).toHaveBeenCalledTimes(1);
    expect(handleURLCallback).toHaveBeenCalledWith(url);
  });

  it("other links are not handed to Stripe", () => {
    renderPayment();

    act(() => urlListener()({ url: "djir://track-ride?rideId=42" }));

    expect(handleURLCallback).not.toHaveBeenCalled();
  });

  it("the link listener is removed on unmount", () => {
    const { unmount } = renderPayment();
    const subscription = mockAddEventListener.mock.results[0].value;

    unmount();

    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });
});

describe("Payment — EG5: no Stripe publishable key", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["a secret key in its place", "sk_test_51NdjirSecret"],
  ])(
    "EG5: with the key %s, the button is off and says which key to add; a tap opens no sheet",
    (_, key) => {
      setStripeKey(key);
      renderPayment();

      expect(screen.getByTestId("payment-not-set-up")).toBeOnTheScreen();
      expect(screen.getByText(PAYMENTS_NOT_SET_UP)).toHaveStyle({
        color: colors.danger["700"],
      });
      expect(PAYMENTS_NOT_SET_UP).toBe(
        "Payments aren't set up in this build: add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_…) to .env.local and restart npx expo start.",
      );
      expect(confirmButton()).toHaveTextContent("Confirm Ride");
      expect(confirmButton()).toBeDisabled();
      tapConfirm();
      expect(initPaymentSheet).not.toHaveBeenCalled();
      expect(presentPaymentSheet).not.toHaveBeenCalled();
      expect(mockBookRide).not.toHaveBeenCalled();
      expect(mockAddEventListener).not.toHaveBeenCalled();
    },
  );

  it("EG5: a scheduled ride's button keeps its 'Schedule Ride' label", () => {
    setStripeKey(undefined);
    renderPayment(quoteOf({ scheduledAt: SLOT }));

    expect(confirmButton()).toHaveTextContent("Schedule Ride");
    expect(confirmButton()).toBeDisabled();
  });

  it("EG5: with a publishable key the button is live and nothing says payments are off", () => {
    renderPayment();

    expect(screen.queryByTestId("payment-not-set-up")).toBeNull();
    expect(confirmButton()).toBeEnabled();
  });
});

describe("Payment.web — the web build", () => {
  it("R70: renders a disabled 'Payments are available in the iOS and Android app' button and never touches Stripe", () => {
    render(
      <WebPayment
        driverId={3}
        quote={quoteOf()}
        pickup={PICKUP}
        dropoff={DROPOFF}
        originAddress="Tresnjevka, Zagreb"
        destinationAddress="Trg bana Jelačića, Zagreb"
        onBooked={jest.fn()}
        onPaidUnconfirmed={jest.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Payments are available in the iOS and Android app",
    });
    expect(button).toHaveTextContent(
      "Payments are available in the iOS and Android app",
    );
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(initPaymentSheet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("payment-confirm")).toBeNull();
  });
});
