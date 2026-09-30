/**
 * The confirm screen ("Choose a Driver"), driven through the real stores: the
 * quote states above the list, a price on every card, Select Ride only once a
 * priced driver is chosen (R13), and the way back to the picker when the
 * server refuses the pickup time (K6, with the real quote hook).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { ScrollView } from "react-native";
import "react-native-gesture-handler/jestSetup";

import ConfirmRide from "@/app/(root)/confirm-ride";
import { useDriverQuotes } from "@/hooks/useDriverQuotes";
import { generateMarkersFromData } from "@/lib/map";
import { ApiError } from "@/services/api";
import { fetchQuote } from "@/services/quotes";
import {
  SLOT_EXPIRED_NOTICE,
  useBookingStore,
  useDriverStore,
  useLocationStore,
} from "@/store";
import { Driver, TripQuote } from "@/types/type";

import { settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import { resetClerk } from "../helpers/mocks/clerk";
import { refocus, resetRouter, router } from "../helpers/mocks/expo-router";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@clerk/expo", () => require("../helpers/mocks/clerk"));
jest.mock("@/services/quotes", () => ({
  ...jest.requireActual("@/services/quotes"),
  fetchQuote: jest.fn(),
}));
jest.mock("@gorhom/bottom-sheet", () =>
  require("../helpers/mocks/bottom-sheet"),
);
jest.mock("@/components/Map", () => require("../helpers/mocks/booking-map"));

const NOW = Date.parse("2026-10-03T19:00:00.000Z"); // Saturday 21:00 in Zagreb
const SLOT = Date.parse("2026-10-04T06:00:00.000Z"); // Sunday 08:00 in Zagreb
const PICKUP = { latitude: 45.8, longitude: 15.945 };

const row = (id: number, first_name: string, rating: string): Driver => ({
  id,
  first_name,
  last_name: "Driver",
  profile_image_url: null,
  car_image_url: null,
  car_seats: 4,
  rating,
});

const drivers = generateMarkersFromData({
  data: [row(3, "Michael", "4.60"), row(5, "Ana", "4.90")],
  pickup: PICKUP,
});

const quote = (overrides: Partial<TripQuote> = {}): TripQuote => ({
  token: "signed-quote",
  fareCents: 974,
  tripMinutes: 12,
  surgeMultiplier: 1,
  source: "model",
  scheduledAt: null,
  issuedAtMs: NOW,
  ...overrides,
});

function arrange(state: Partial<ReturnType<typeof useDriverStore.getState>>) {
  useDriverStore.setState({ drivers, ...state });
  render(<ConfirmRide />);
  return { selectRide: screen.getByTestId("select-ride") };
}

const mockFetchQuote = jest.mocked(fetchQuote);

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetRouter();
  resetClerk();
  mockFetchQuote.mockReset();
  useDriverStore.getState().reset();
  useBookingStore.getState().reset();
  useLocationStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("confirm-ride — R13 Select Ride", () => {
  it("R13: with a price but no driver chosen, Select Ride is disabled and goes nowhere", () => {
    const { selectRide } = arrange({ quote: quote(), quoteStatus: "ready" });

    fireEvent.press(selectRide);

    expect(selectRide).toHaveTextContent("Select Ride");
    expect(selectRide).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("R13: choosing a driver enables Select Ride, which opens book-ride", () => {
    const { selectRide } = arrange({ quote: quote(), quoteStatus: "ready" });

    fireEvent.press(screen.getByTestId("driver-card-5"));
    fireEvent.press(selectRide);

    expect(useDriverStore.getState().selectedDriver).toBe(5);
    expect(screen.getByTestId("driver-card-5")).toBeChecked();
    expect(screen.getByTestId("driver-card-3")).not.toBeChecked();
    expect(selectRide).toBeEnabled();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/(root)/book-ride");
  });

  it("R13: a chosen driver is not enough while the quote is still loading", () => {
    const { selectRide } = arrange({
      quote: quote(),
      quoteStatus: "loading",
      selectedDriver: 3,
    });

    fireEvent.press(selectRide);

    expect(selectRide).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each(["idle", "error", "ready"] as const)(
    "R13: with the quote %s but no quote in hand, a chosen driver can't be booked",
    (quoteStatus) => {
      const { selectRide } = arrange({
        quote: null,
        quoteStatus,
        selectedDriver: 3,
      });

      fireEvent.press(selectRide);

      expect(selectRide).toBeDisabled();
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it("R13: when a fresh quote arrives for a chosen driver, Select Ride turns on", () => {
    const { selectRide } = arrange({
      quote: null,
      quoteStatus: "loading",
      selectedDriver: 3,
    });
    expect(selectRide).toBeDisabled();

    act(() => useDriverStore.getState().setQuote("ready", quote()));

    expect(selectRide).toBeEnabled();
  });
});

describe("confirm-ride — the quote states (Q1–Q4)", () => {
  it("Q1: while quoting, the list shows 'Finding prices…' and '…' on every card", () => {
    arrange({ quote: quote(), quoteStatus: "loading" });

    expect(screen.getByTestId("quotes-loading")).toHaveTextContent(
      "Finding prices…",
    );
    for (const { id } of drivers) {
      expect(
        within(screen.getByTestId(`driver-card-${id}`)).getByTestId(
          "driver-fare",
        ),
      ).toHaveTextContent("…");
    }
  });

  it("P3c: a failed refresh keeps the quote in the store, but the list prices nothing and Select Ride stays off", () => {
    const { selectRide } = arrange({
      quote: quote({ fareCents: 1234 }),
      quoteStatus: "error",
      quoteError: "Network request failed",
      selectedDriver: 3,
    });

    fireEvent.press(selectRide);

    expect(screen.getByTestId("quotes-error")).toHaveTextContent(
      "Couldn't get pricesNetwork request failedRetry",
    );
    for (const { id } of drivers) {
      expect(
        within(screen.getByTestId(`driver-card-${id}`)).getByTestId(
          "driver-fare",
        ),
      ).toHaveTextContent("…");
    }
    expect(selectRide).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("Q2: an error shows 'Couldn't get prices', and Retry asks the store for a new quote", () => {
    arrange({ quoteStatus: "error", quoteError: "Network request failed" });
    const before = useDriverStore.getState().quoteRequest;

    fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByTestId("quotes-error")).toHaveTextContent(
      "Couldn't get pricesNetwork request failedRetry",
    );
    expect(useDriverStore.getState().quoteRequest).toBe(before + 1);
  });

  it("Q3: a ready quote puts its price on every driver card", () => {
    arrange({ quote: quote({ fareCents: 1234 }), quoteStatus: "ready" });

    for (const { id } of drivers) {
      expect(
        within(screen.getByTestId(`driver-card-${id}`)).getByTestId(
          "driver-fare",
        ),
      ).toHaveTextContent("€12.34");
    }
    expect(screen.queryByTestId("quotes-loading")).toBeNull();
    expect(screen.queryByTestId("quotes-error")).toBeNull();
  });

  it("Q4: a surged quote shows 'High demand · ×1.4' above the list", () => {
    arrange({ quote: quote({ surgeMultiplier: 1.4 }), quoteStatus: "ready" });

    expect(screen.getByTestId("quote-surge")).toHaveTextContent(
      "High demand · ×1.4",
    );
  });

  it("Q4: an unsurged quote has no surge line", () => {
    arrange({ quote: quote({ surgeMultiplier: 1 }), quoteStatus: "ready" });

    expect(screen.queryByTestId("quote-surge")).toBeNull();
  });
});

describe("confirm-ride — K6: the server refused the pickup time", () => {
  /** The (root) layout's data owner, mounted beside the screen as in the app. */
  const BookingData = () => {
    useDriverQuotes();
    return null;
  };

  const realFetch = global.fetch;
  beforeEach(() => {
    // GET /driver never answers: the drivers placed below stay as they are.
    global.fetch = jest.fn(() => new Promise(() => {})) as never;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("K6: a quote answered 400 slot_unavailable sends the rider back to Find ride, with the pickup time reset to Now", async () => {
    mockFetchQuote
      .mockRejectedValueOnce(
        new ApiError("That pickup time is no longer available", 400, {
          error: "That pickup time is no longer available",
          code: "slot_unavailable",
        }),
      )
      .mockReturnValueOnce(new Promise(() => {}));
    useLocationStore.setState({
      userLatitude: PICKUP.latitude,
      userLongitude: PICKUP.longitude,
      userAddress: "Tresnjevka, Zagreb",
      destinationLatitude: 45.8131,
      destinationLongitude: 15.9772,
      destinationAddress: "Trg bana Jelačića, Zagreb",
    });
    useBookingStore.setState({ scheduledAt: SLOT });
    useDriverStore.setState({ drivers });

    render(
      <>
        <BookingData />
        <ConfirmRide />
      </>,
    );
    await settle();

    // dismissTo pops back to Find ride; navigate would push a second one.
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith("/(root)/find-ride");
    expect(router.navigate).not.toHaveBeenCalled();
    expect(useBookingStore.getState()).toMatchObject({
      scheduledAt: null,
      slotNotice: SLOT_EXPIRED_NOTICE,
    });
    expect(mockFetchQuote.mock.calls.map((call) => call[2])).toEqual([
      SLOT,
      null,
    ]);
  });

  it("K6: without a slot notice the list stays put", () => {
    arrange({ quote: quote(), quoteStatus: "ready" });

    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe("confirm-ride — the driver list's own states (Q5, Q6)", () => {
  const OFFLINE = "Network request failed";
  const reloads = () => useDriverStore.getState().driversRequest;

  it("Q5: drivers that failed to load read 'Couldn't load drivers', the message and Retry, in place of the cards", () => {
    const { selectRide } = arrange({
      drivers: [],
      driversStatus: "error",
      driversError: OFFLINE,
      quote: quote(),
      quoteStatus: "ready",
    });

    expect(screen.getByTestId("drivers-error")).toHaveTextContent(
      `Couldn't load drivers${OFFLINE}Retry`,
    );
    expect(screen.queryByTestId("drivers-empty")).toBeNull();
    expect(screen.queryByTestId(/^driver-card-/)).toBeNull();
    expect(selectRide).toBeDisabled();
  });

  it("Q5: Retry asks the store to load the drivers again", () => {
    arrange({ drivers: [], driversStatus: "error", driversError: OFFLINE });
    const before = reloads();

    fireEvent.press(screen.getByTestId("drivers-retry"));

    expect(screen.getByTestId("drivers-retry")).toHaveTextContent("Retry");
    expect(reloads()).toBe(before + 1);
  });

  it("Q5: arriving on the list after a failed load reloads the drivers, and so does coming back to it", () => {
    arrange({ drivers: [], driversStatus: "error", driversError: OFFLINE });
    expect(screen.getByTestId("drivers-error")).toBeOnTheScreen();
    expect(reloads()).toBe(1);

    refocus();

    expect(reloads()).toBe(2);
  });

  it("Q5: a reload that fails again waits for the next focus or Retry — it never retries by itself", () => {
    arrange({ drivers: [], driversStatus: "error", driversError: OFFLINE });
    expect(reloads()).toBe(1);

    act(() => useDriverStore.getState().setDriversStatus("loading"));
    act(() => useDriverStore.getState().setDriversStatus("error", OFFLINE));

    expect(screen.getByTestId("drivers-error")).toBeOnTheScreen();
    expect(reloads()).toBe(1);
  });

  it("Q5: after a good load, focus reloads nothing", () => {
    arrange({ driversStatus: "ready", quote: quote(), quoteStatus: "ready" });

    refocus();

    expect(reloads()).toBe(0);
    expect(screen.queryByTestId("drivers-error")).toBeNull();
  });

  it("Q5: while the drivers reload, 'Finding drivers…' shows in place of the cards", () => {
    arrange({ drivers: [], driversStatus: "loading" });

    expect(screen.getByTestId("drivers-loading")).toHaveTextContent(
      "Finding drivers…",
    );
    expect(screen.queryByTestId("drivers-error")).toBeNull();
  });

  it("Q6: a list that loaded with no driver says 'No drivers are available right now', and Select Ride stays off", () => {
    const { selectRide } = arrange({
      drivers: [],
      driversStatus: "ready",
      quote: quote(),
      quoteStatus: "ready",
    });

    expect(screen.getByTestId("drivers-empty")).toHaveTextContent(
      "No drivers are available right now",
    );
    expect(screen.queryByTestId("drivers-error")).toBeNull();
    expect(screen.queryByTestId("drivers-loading")).toBeNull();
    expect(selectRide).toBeDisabled();
  });

  describe("with the real quote hook", () => {
    const BookingData = () => {
      useDriverQuotes();
      return null;
    };
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it("Q5: offline when the app loaded the drivers, then online: Retry places them and one can be chosen", async () => {
      const rows = [row(3, "Michael", "4.60"), row(5, "Ana", "4.90")];
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new TypeError(OFFLINE))
        .mockResolvedValueOnce(fetchResponse(200, { data: rows })) as never;
      mockFetchQuote.mockResolvedValue(quote());
      useLocationStore.setState({
        userLatitude: PICKUP.latitude,
        userLongitude: PICKUP.longitude,
        userAddress: "Tresnjevka, Zagreb",
        destinationLatitude: 45.8131,
        destinationLongitude: 15.9772,
        destinationAddress: "Trg bana Jelačića, Zagreb",
      });
      render(<BookingData />);
      await settle();
      expect(useDriverStore.getState().driversStatus).toBe("error");

      render(<ConfirmRide />); // the rider reaches the list later
      await settle();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId("drivers-error")).toBeNull();
      fireEvent.press(screen.getByTestId("driver-card-5"));
      expect(screen.getByTestId("select-ride")).toBeEnabled();
    });

    it("Q5: still offline: the list shows the error, and Retry tries once more", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new TypeError(OFFLINE)) as never;
      mockFetchQuote.mockReturnValue(new Promise(() => {}));
      render(
        <>
          <BookingData />
          <ConfirmRide />
        </>,
      );
      await settle();
      await settle();
      const tries = jest.mocked(global.fetch).mock.calls.length;

      fireEvent.press(screen.getByTestId("drivers-retry"));
      await settle();

      expect(screen.getByTestId("drivers-error")).toHaveTextContent(
        `Couldn't load drivers${OFFLINE}Retry`,
      );
      expect(jest.mocked(global.fetch).mock.calls.length).toBe(tries + 1);
    });
  });
});

describe("confirm-ride — layout", () => {
  it("a ride now shows each driver's pickup minutes and no pickup header", () => {
    arrange({ quote: quote(), quoteStatus: "ready" });

    for (const { id, pickupMinutes } of drivers) {
      expect(
        within(screen.getByTestId(`driver-card-${id}`)).getByTestId(
          "driver-pickup",
        ),
      ).toHaveTextContent(`${pickupMinutes} min away`);
    }
    expect(screen.queryByTestId("quote-pickup")).toBeNull();
  });

  it("W5: a scheduled ride shows 'Pickup · Tomorrow · 08:00' in place of per-driver minutes", () => {
    useBookingStore.setState({ scheduledAt: SLOT });

    arrange({ quote: quote({ scheduledAt: SLOT }), quoteStatus: "ready" });

    expect(screen.getByTestId("quote-pickup")).toHaveTextContent(
      "Pickup · Tomorrow · 08:00",
    );
    expect(screen.queryByTestId("driver-pickup")).toBeNull();
  });

  it("R48: the driver list is the sheet's only scroll view, under 'Choose a Driver'", () => {
    arrange({ quote: quote(), quoteStatus: "ready" });

    expect(screen.getByTestId("ride-layout-title")).toHaveTextContent(
      "Choose a Driver",
    );
    expect(screen.UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
  });
});
