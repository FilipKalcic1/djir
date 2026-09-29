/**
 * The Book Ride screen on the real stores: the trip it shows (WP4 Surfaces
 * "Book Ride", K11, R13), what follows a payment (P6, P7, P10, N3), and what
 * it does when a refresh fails or the slot is gone (P3c, K6). Payment is a
 * stub exposing its props, except where the real button — with the Stripe
 * mock and, for K6, the real quote hook — is the point.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Alert, AlertButton } from "react-native";

import BookRide from "@/app/(root)/book-ride";
import { useDriverQuotes } from "@/hooks/useDriverQuotes";
import { generateMarkersFromData } from "@/lib/map";
import { reminderFor } from "@/lib/reminders";
import { ApiError } from "@/services/api";
import { bookRide, confirmRide } from "@/services/booking";
import { setServerTime } from "@/services/clock";
import { fetchQuote } from "@/services/quotes";
import { remindAbout } from "@/services/reminders";
import {
  SLOT_EXPIRED_NOTICE,
  useBookingStore,
  useDriverStore,
  useLocationStore,
} from "@/store";
import { Driver, Ride, TripQuote } from "@/types/type";

import { settle } from "../helpers/async";
import { resetClerk } from "../helpers/mocks/clerk";
import { resetRouter, router } from "../helpers/mocks/expo-router";
import {
  initPaymentSheet,
  presentPaymentSheet,
  resetStripe,
} from "../helpers/mocks/stripe";
import { makeRide, MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

import type { PaymentProps } from "@/components/Payment";

/** `real`: render the actual Payment; either way `props` holds what Book Ride passed. */
const mockPayment = { real: false, props: null as PaymentProps | null };

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));
jest.mock("@stripe/stripe-react-native", () =>
  require("../helpers/mocks/stripe"),
);
jest.mock("expo-linking", () => ({
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock("@/services/booking", () => ({
  ...jest.requireActual("@/services/booking"),
  bookRide: jest.fn(),
  confirmRide: jest.fn(),
}));
jest.mock("@/services/quotes", () => ({
  ...jest.requireActual("@/services/quotes"),
  fetchQuote: jest.fn(),
}));
jest.mock("@/services/reminders", () => ({
  remindAbout: jest.fn(async () => {}),
}));
jest.mock("@/components/Payment", () => {
  const actual = jest.requireActual("@/components/Payment");
  const { View } = jest.requireActual("react-native");
  return {
    ...actual,
    __esModule: true,
    default: function MockPayment(props: PaymentProps) {
      mockPayment.props = props;
      const Real = actual.default;
      return mockPayment.real ? (
        <Real {...props} />
      ) : (
        <View testID="payment-stub" />
      );
    },
  };
});
jest.mock("@/components/RideLayout", () =>
  require("../helpers/mocks/ride-layout"),
);
jest.mock("react-native-modal", () =>
  require("../helpers/mocks/react-native-modal"),
);

const mockBookRide = jest.mocked(bookRide);
const mockConfirmRide = jest.mocked(confirmRide);
const mockFetchQuote = jest.mocked(fetchQuote);
const mockRemindAbout = jest.mocked(remindAbout);

const NOW = Date.parse("2026-10-03T19:00:00.000Z"); // Saturday 21:00 in Zagreb
const SLOT = Date.parse("2026-10-04T06:00:00.000Z"); // Sunday 08:00 in Zagreb
const PICKUP = { latitude: 45.8, longitude: 15.945 };
const DROPOFF = { latitude: 45.8131, longitude: 15.9772 };

const michael: Driver = {
  id: 3,
  first_name: "Michael",
  last_name: "Johnson",
  profile_image_url: null,
  car_image_url: null,
  car_seats: 4,
  rating: "4.90",
};
const drivers = generateMarkersFromData({ data: [michael], pickup: PICKUP });

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
const rideNow = makeRide({ ride_id: 42 });
const scheduledRide = makeRide({
  ride_id: 42,
  scheduled_at: new Date(SLOT).toISOString(),
});

function arrange(quote: TripQuote = quoteOf()) {
  useLocationStore.setState({
    userLatitude: PICKUP.latitude,
    userLongitude: PICKUP.longitude,
    userAddress: "Tresnjevka, Zagreb",
    destinationLatitude: DROPOFF.latitude,
    destinationLongitude: DROPOFF.longitude,
    destinationAddress: "Trg bana Jelačića, Zagreb",
  });
  useDriverStore.setState({
    drivers,
    selectedDriver: 3,
    quote,
    quoteStatus: "ready",
  });
  useBookingStore.setState({ scheduledAt: quote.scheduledAt });
}

/** Payment reports a paid, confirmed ride (P6). */
const booked = (ride: Ride) => act(() => mockPayment.props!.onBooked(ride));

let alert: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  setServerTime(new Date(NOW).toISOString(), NOW); // no skew unless a test says so
  Object.assign(mockPayment, { real: false, props: null });
  resetRouter();
  resetClerk();
  resetStripe();
  useLocationStore.getState().reset();
  useDriverStore.getState().reset();
  useBookingStore.getState().reset();
  mockBookRide.mockReset();
  mockConfirmRide.mockReset();
  mockFetchQuote.mockReset();
  mockRemindAbout.mockClear();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("book-ride — the trip", () => {
  it("R13: reached without a chosen driver, it says 'Choose a driver first.' and offers no payment", () => {
    arrange();
    useDriverStore.setState({ selectedDriver: null });

    render(<BookRide />);

    expect(screen.getByText("Choose a driver first.")).toBeOnTheScreen();
    expect(screen.queryByTestId("payment-stub")).toBeNull();
  });

  it("W6 C4: a ride now shows the driver, the fare in general-400 and a Pickup time row (book-pickup-time) with the driver's minutes", () => {
    arrange();

    render(<BookRide />);

    expect(screen.getByText("Michael Johnson")).toBeOnTheScreen();
    expect(screen.getByTestId("book-fare")).toHaveTextContent("€9.74");
    expect(screen.getByTestId("book-fare")).toHaveStyle({
      color: colors.general["400"],
    });
    expect(screen.getByTestId("book-pickup-time")).toHaveTextContent(
      `In ${Math.ceil(drivers[0].pickupMinutes)} min`,
    );
    expect(mockPayment.props).toMatchObject({
      driverId: 3,
      quote: quoteOf(),
      pickup: PICKUP,
      dropoff: DROPOFF,
      originAddress: "Tresnjevka, Zagreb",
      destinationAddress: "Trg bana Jelačića, Zagreb",
    });
  });

  it("W6 C4: a scheduled ride's Pickup time row reads the slot, 'Tomorrow · 08:00'", () => {
    arrange(quoteOf({ scheduledAt: SLOT }));

    render(<BookRide />);

    expect(screen.getByTestId("book-pickup-time")).toHaveTextContent(
      "Tomorrow · 08:00",
    );
  });

  it.each([
    ["a ride now", null, "Rides booked for now can't be cancelled."],
    ["a scheduled ride", SLOT, "Free cancellation until your driver sets off."],
  ])(
    "W10: %s states its cancellation policy before paying",
    (_, scheduledAt, text) => {
      arrange(quoteOf({ scheduledAt }));

      render(<BookRide />);

      expect(screen.getByTestId("book-cancel-policy")).toHaveTextContent(text);
      expect(screen.getByTestId("book-cancel-policy")).toHaveStyle({
        color: colors.general["200"],
      });
    },
  );

  it("K11: the day is named on the server's clock — past midnight on the server, a device 10 min slow still reads 'Today'", () => {
    const serverMs = Date.parse("2026-10-03T22:05:00.000Z"); // Sunday 00:05 in Zagreb
    jest.setSystemTime(serverMs - 10 * MIN); // the device says Saturday 23:55
    setServerTime(new Date(serverMs).toISOString());
    arrange(quoteOf({ scheduledAt: SLOT }));
    render(<BookRide />);

    booked(scheduledRide);

    expect(screen.getByTestId("book-pickup-time")).toHaveTextContent(
      "Today · 08:00",
    );
    expect(
      screen.getByText(
        "Michael will pick you up today at 08:00. Free cancellation until your driver sets off.",
      ),
    ).toBeOnTheScreen();
  });
});

describe("book-ride — after the payment", () => {
  it("P6: onBooked shows 'Booking placed successfully' (booking-success); Go Track opens the ride's tracker", () => {
    arrange();
    render(<BookRide />);
    expect(screen.queryByTestId("booking-success")).toBeNull();

    booked(rideNow);
    fireEvent.press(screen.getByRole("button", { name: "Go Track" }));

    expect(screen.getByTestId("booking-success")).toHaveTextContent(
      /Booking placed successfully/,
    );
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/(root)/track-ride",
      params: { rideId: "42" },
    });
    expect(mockRemindAbout).toHaveBeenCalledWith(null); // a ride now needs none
  });

  it("N3: Back Home after a scheduled booking goes Home, resets the flow and asks for the ride's reminder", () => {
    arrange(quoteOf({ scheduledAt: SLOT }));
    render(<BookRide />);

    booked(scheduledRide);
    expect(screen.getByTestId("booking-success-scheduled")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Back Home" }));

    expect(router.navigate).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(mockRemindAbout).toHaveBeenCalledTimes(1);
    expect(mockRemindAbout).toHaveBeenCalledWith(
      reminderFor(scheduledRide, NOW),
    );
    expect(mockRemindAbout.mock.calls[0][0]).not.toBeNull();
    expect(useBookingStore.getState().scheduledAt).toBeNull();
  });

  it("P7: paid but unconfirmed alerts 'Payment received'; OK goes to Rides and resets the booking flow", () => {
    arrange();
    render(<BookRide />);

    act(() => mockPayment.props!.onPaidUnconfirmed());

    expect(alert).toHaveBeenCalledWith(
      "Payment received",
      "Your ride will appear in Rides shortly.",
      [{ text: "OK", onPress: expect.any(Function) }],
    );
    const [ok] = alert.mock.calls[0][2] as AlertButton[];
    act(() => ok.onPress!());

    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith("/(root)/(tabs)/rides");
    expect(useLocationStore.getState().destinationAddress).toBeNull();
    expect(useDriverStore.getState()).toMatchObject({
      selectedDriver: null,
      quote: null,
    });
    expect(mockRemindAbout).not.toHaveBeenCalled();
  });

  it("P10: a double tap leaves once — one dismissAll, one navigation, one reminder request", () => {
    arrange(quoteOf({ scheduledAt: SLOT }));
    render(<BookRide />);
    booked(scheduledRide);

    const backHome = screen.getByRole("button", { name: "Back Home" });
    fireEvent.press(backHome);
    fireEvent.press(backHome);
    fireEvent.press(screen.getByRole("button", { name: "View ride" }));

    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(mockRemindAbout).toHaveBeenCalledTimes(1);
  });

  it("P10: the stores are reset after navigating, and Book Ride keeps showing the booked ride while it animates out", () => {
    arrange(quoteOf({ scheduledAt: SLOT }));
    render(<BookRide />);
    booked(scheduledRide);
    const order: string[] = [];
    router.dismissAll.mockImplementation(() => order.push("dismissAll"));
    router.navigate.mockImplementation(() => order.push("navigate"));
    const unsubscribe = useDriverStore.subscribe(() => order.push("reset"));

    fireEvent.press(screen.getByRole("button", { name: "Back Home" }));
    unsubscribe();

    expect(order.slice(0, 3)).toEqual(["dismissAll", "navigate", "reset"]);
    expect(useDriverStore.getState().selectedDriver).toBeNull();
    expect(screen.queryByText("Choose a driver first.")).toBeNull();
    expect(screen.getByTestId("booking-success-scheduled")).toBeOnTheScreen();
    expect(screen.getByTestId("book-fare")).toHaveTextContent("€9.74");
  });
});

describe("book-ride — with the real Payment", () => {
  const staleQuote = (overrides: Partial<TripQuote> = {}) =>
    quoteOf({ issuedAtMs: NOW - 5 * MIN, ...overrides });
  const confirmButton = () => screen.getByTestId("payment-confirm");

  const realFetch = global.fetch;
  beforeEach(() => {
    mockPayment.real = true;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("P3c: a refresh that fails keeps Book Ride — driver, fare, 'Couldn't refresh the price…' and the button — never 'Choose a driver first.'", () => {
    arrange(staleQuote());
    render(<BookRide />);

    fireEvent.press(confirmButton());
    act(() => useDriverStore.getState().setQuote("loading"));
    act(() =>
      useDriverStore
        .getState()
        .setQuote(
          "error",
          null,
          "Couldn't get prices. Check your connection and try again.",
        ),
    );

    expect(screen.queryByText("Choose a driver first.")).toBeNull();
    expect(screen.getByText("Michael Johnson")).toBeOnTheScreen();
    expect(screen.getByTestId("book-fare")).toHaveTextContent("€9.74");
    expect(screen.getByTestId("payment-requote-error")).toHaveTextContent(
      "Couldn't refresh the price. Couldn't get prices. Check your connection and try again.",
    );
    expect(confirmButton()).toBeEnabled();
    expect(initPaymentSheet).not.toHaveBeenCalled();
  });

  describe("P3 through the store and the real quote hook", () => {
    const BookingData = () => {
      useDriverQuotes();
      return null;
    };
    /** Book Ride on a 5-min-old quote; the hook's refresh answers `fresh`. */
    async function arrangeStale(fresh: TripQuote) {
      global.fetch = jest.fn(() => new Promise(() => {})) as never; // GET /driver
      const stale = staleQuote();
      mockFetchQuote.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
      mockBookRide.mockResolvedValue({
        ride_id: 42,
        client_secret: "pi_42_secret",
        status: "succeeded",
      });
      mockConfirmRide.mockResolvedValue(rideNow);
      arrange(stale);
      render(
        <>
          <BookingData />
          <BookRide />
        </>,
      );
      await settle();
    }

    it("P3: a stale quote refreshed at the same fare opens the sheet by itself and books with the fresh token", async () => {
      await arrangeStale(quoteOf({ token: "fresh-token", issuedAtMs: NOW }));

      fireEvent.press(confirmButton());
      await settle();
      await settle();

      expect(mockFetchQuote).toHaveBeenCalledTimes(2);
      expect(initPaymentSheet).toHaveBeenCalledTimes(1);
      expect(presentPaymentSheet).toHaveBeenCalledTimes(1);
      expect(mockBookRide.mock.calls[0][0]).toMatchObject({
        quoteToken: "fresh-token",
        driverId: 3,
      });
      expect(screen.getByTestId("book-fare")).toHaveTextContent("€9.74");
      expect(screen.queryByTestId("payment-price-updated")).toBeNull();
    });

    it("P3: a stale quote refreshed at a new fare shows 'Price updated: €9.74 → €10.20' and the new fare, and opens no sheet until a second tap", async () => {
      await arrangeStale(
        quoteOf({ token: "fresh-token", fareCents: 1020, issuedAtMs: NOW }),
      );

      fireEvent.press(confirmButton());
      await settle();
      await settle();

      expect(screen.getByTestId("payment-price-updated")).toHaveTextContent(
        "Price updated: €9.74 → €10.20",
      );
      expect(screen.getByTestId("book-fare")).toHaveTextContent("€10.20");
      expect(confirmButton()).toBeEnabled();
      expect(initPaymentSheet).not.toHaveBeenCalled();
      expect(mockBookRide).not.toHaveBeenCalled();
    });
  });

  it("K6: the P3 re-quote answered 400 slot_unavailable goes back to Find ride and opens no sheet, even once a ride-now quote lands", async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as never; // GET /driver
    const stale = staleQuote({ scheduledAt: SLOT });
    mockFetchQuote
      .mockResolvedValueOnce(stale)
      .mockRejectedValueOnce(
        new ApiError("That pickup time is no longer available", 400, {
          error: "That pickup time is no longer available",
          code: "slot_unavailable",
        }),
      )
      .mockResolvedValueOnce(quoteOf({ token: "now-quote", issuedAtMs: NOW }));
    arrange(stale);
    const BookingData = () => {
      useDriverQuotes();
      return null;
    };
    render(
      <>
        <BookingData />
        <BookRide />
      </>,
    );
    await settle();

    fireEvent.press(confirmButton());
    await settle();
    await settle();

    expect(mockFetchQuote.mock.calls.map((call) => call[2])).toEqual([
      SLOT,
      SLOT,
      null,
    ]);
    expect(router.navigate).toHaveBeenCalledWith("/(root)/find-ride");
    expect(useBookingStore.getState()).toMatchObject({
      scheduledAt: null,
      slotNotice: SLOT_EXPIRED_NOTICE,
    });
    expect(useDriverStore.getState().quote?.token).toBe("now-quote");
    expect(initPaymentSheet).not.toHaveBeenCalled();
    expect(presentPaymentSheet).not.toHaveBeenCalled();
    expect(screen.queryByText("Choose a driver first.")).toBeNull();
  });

  it("K6: a booking answered 409 slot_unavailable goes back to Find ride once the sheet has closed", async () => {
    mockBookRide.mockRejectedValueOnce(
      new ApiError("That pickup time is no longer available", 409, {
        error: "That pickup time is no longer available",
        code: "slot_unavailable",
      }),
    );
    arrange(quoteOf({ scheduledAt: SLOT }));
    render(<BookRide />);

    fireEvent.press(confirmButton());

    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith("/(root)/find-ride"),
    );
    expect(useBookingStore.getState().slotNotice).toBe(SLOT_EXPIRED_NOTICE);
    expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByText("Choose a driver first.")).toBeNull();
  });
});
