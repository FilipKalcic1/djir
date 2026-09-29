import { checkSlot } from "@/lib/schedule";
import {
  resetBookingFlow,
  resetSession,
  SLOT_EXPIRED_NOTICE,
  useBookingStore,
  useDriverStore,
  useLocationStore,
} from "@/store";
import { MarkerData, TripQuote } from "@/types/type";

const HOME = {
  latitude: 45.8,
  longitude: 15.945,
  address: "Tresnjevka, Zagreb",
};
const SQUARE = {
  latitude: 45.8131,
  longitude: 15.9772,
  address: "Trg bana Jelačića, Zagreb",
};
const QUOTE: TripQuote = {
  token: "quote.token",
  fareCents: 974,
  tripMinutes: 12,
  surgeMultiplier: 1,
  source: "ml-model",
  scheduledAt: null,
  issuedAtMs: Date.parse("2026-10-03T19:00:00Z"),
};
const NEWER_QUOTE: TripQuote = {
  ...QUOTE,
  token: "newer.token",
  fareCents: 1022,
};
const MICHAEL: MarkerData = {
  id: 3,
  first_name: "Michael",
  last_name: "Johnson",
  profile_image_url: null,
  car_image_url: null,
  car_seats: 4,
  rating: "4.9",
  latitude: 45.79,
  longitude: 15.93,
  title: "Michael Johnson",
  pickupMinutes: 7,
};
const SLOT = Date.parse("2026-10-04T06:00:00Z");

const pristine = {
  location: useLocationStore.getState(),
  drivers: useDriverStore.getState(),
  booking: useBookingStore.getState(),
};

/** Every data field of every store set away from its initial value. */
function fillEveryStore() {
  useLocationStore.setState({
    userLatitude: HOME.latitude,
    userLongitude: HOME.longitude,
    userAddress: HOME.address,
    destinationLatitude: SQUARE.latitude,
    destinationLongitude: SQUARE.longitude,
    destinationAddress: SQUARE.address,
  });
  useDriverStore.setState({
    drivers: [MICHAEL],
    driversStatus: "error",
    driversError: "Network request failed",
    driversRequest: 1,
    quote: QUOTE,
    quoteStatus: "ready",
    quoteError: "Couldn't get prices",
    quoteRequest: 2,
    selectedDriver: 3,
  });
  useBookingStore.setState({
    scheduledAt: SLOT,
    slotNotice: "That pickup time is no longer available — choose a new time",
  });
}

beforeEach(() => {
  useLocationStore.setState(pristine.location, true);
  useDriverStore.setState(pristine.drivers, true);
  useBookingStore.setState(pristine.booking, true);
});

describe("resetSession (sign-out)", () => {
  it("R52: resets every store, so the next user sees nothing of this one", () => {
    fillEveryStore();
    const initial: Record<string, unknown> = {
      ...pristine.location,
      ...pristine.drivers,
      ...pristine.booking,
    };
    const filled = {
      ...useLocationStore.getState(),
      ...useDriverStore.getState(),
      ...useBookingStore.getState(),
    };
    for (const [key, value] of Object.entries(filled)) {
      if (typeof value === "function") continue;
      expect([key, value]).not.toEqual([key, initial[key]]); // guard: all dirty
    }

    resetSession();

    expect(useLocationStore.getState()).toEqual(pristine.location);
    expect(useDriverStore.getState()).toEqual(pristine.drivers);
    expect(useBookingStore.getState()).toEqual(pristine.booking);
  });
});

describe("resetBookingFlow (after a booking)", () => {
  beforeEach(() => {
    fillEveryStore();
    resetBookingFlow();
  });

  it("R52: keeps where the rider is", () => {
    expect(useLocationStore.getState()).toMatchObject({
      userLatitude: HOME.latitude,
      userLongitude: HOME.longitude,
      userAddress: HOME.address,
    });
  });

  it("R52: clears the destination, the chosen driver, the quote, the pickup time and any slot notice", () => {
    expect(useLocationStore.getState()).toMatchObject({
      destinationLatitude: null,
      destinationLongitude: null,
      destinationAddress: null,
    });
    expect(useDriverStore.getState()).toMatchObject({
      selectedDriver: null,
      quote: null,
      quoteStatus: "idle",
      quoteError: null,
    });
    expect(useBookingStore.getState()).toMatchObject({
      scheduledAt: null,
      slotNotice: null,
    });
  });

  it("keeps the drivers placed around the rider, and how their load went", () => {
    expect(useDriverStore.getState()).toMatchObject({
      drivers: [MICHAEL],
      driversStatus: "error",
      driversError: "Network request failed",
      driversRequest: 1,
    });
  });
});

describe("the location store", () => {
  it("setUserLocation sets the pickup and clears the chosen driver", () => {
    useDriverStore.setState({ selectedDriver: 3 });
    useLocationStore.getState().setUserLocation(HOME);
    expect(useLocationStore.getState()).toMatchObject({
      userLatitude: HOME.latitude,
      userLongitude: HOME.longitude,
      userAddress: HOME.address,
      destinationAddress: null,
    });
    expect(useDriverStore.getState().selectedDriver).toBeNull();
  });

  it("setDestinationLocation sets the destination and clears the chosen driver", () => {
    useDriverStore.setState({ selectedDriver: 3 });
    useLocationStore.getState().setDestinationLocation(SQUARE);
    expect(useLocationStore.getState()).toMatchObject({
      destinationLatitude: SQUARE.latitude,
      destinationLongitude: SQUARE.longitude,
      destinationAddress: SQUARE.address,
      userAddress: null,
    });
    expect(useDriverStore.getState().selectedDriver).toBeNull();
  });
});

describe("the booking store", () => {
  it("setScheduledAt sets the pickup time and clears the chosen driver (prices change with time)", () => {
    useDriverStore.setState({ selectedDriver: 3 });
    useBookingStore.getState().setScheduledAt(SLOT);
    expect(useBookingStore.getState().scheduledAt).toBe(SLOT);
    expect(useDriverStore.getState().selectedDriver).toBeNull();
  });

  it("setScheduledAt(null) goes back to a ride now, also clearing the driver", () => {
    useBookingStore.setState({ scheduledAt: SLOT });
    useDriverStore.setState({ selectedDriver: 3 });
    useBookingStore.getState().setScheduledAt(null);
    expect(useBookingStore.getState().scheduledAt).toBeNull();
    expect(useDriverStore.getState().selectedDriver).toBeNull();
  });

  it("K6: expireSlot(notice) goes back to a ride now, keeps the notice for Find ride and clears the driver", () => {
    useBookingStore.setState({ scheduledAt: SLOT });
    useDriverStore.setState({ selectedDriver: 3, quote: QUOTE });

    useBookingStore.getState().expireSlot(SLOT_EXPIRED_NOTICE);

    expect(useBookingStore.getState()).toMatchObject({
      scheduledAt: null,
      slotNotice: "That pickup time is no longer available — choose a new time",
    });
    expect(useDriverStore.getState().selectedDriver).toBeNull();
    expect(useDriverStore.getState().quote).toBe(QUOTE);
  });

  it("K6: choosing a pickup time (Home's reset to Now included) drops a leftover slot notice", () => {
    useBookingStore.setState({ slotNotice: SLOT_EXPIRED_NOTICE });

    useBookingStore.getState().setScheduledAt(null);

    expect(useBookingStore.getState().slotNotice).toBeNull();
  });

  it("K6: clearSlotNotice clears the notice and nothing else", () => {
    useBookingStore.setState({ scheduledAt: SLOT, slotNotice: "Gone" });
    useDriverStore.setState({ selectedDriver: 3 });

    useBookingStore.getState().clearSlotNotice();

    expect(useBookingStore.getState()).toMatchObject({
      scheduledAt: SLOT,
      slotNotice: null,
    });
    expect(useDriverStore.getState().selectedDriver).toBe(3);
  });

  it("K5 K6: a slot the server refused opens the picker with K5's copy", () => {
    const k5 = checkSlot(SLOT, SLOT + 60 * 60_000);

    expect(k5).toEqual({ status: "expired", notice: SLOT_EXPIRED_NOTICE });
    expect(SLOT_EXPIRED_NOTICE).toBe(
      "That pickup time is no longer available — choose a new time",
    );
  });
});

describe("the driver store's quote", () => {
  it('setQuote("loading") keeps the previous quote (a payment in progress stays mounted) and clears the error', () => {
    useDriverStore.setState({
      quote: QUOTE,
      quoteStatus: "error",
      quoteError: "Couldn't get prices",
    });
    useDriverStore.getState().setQuote("loading");
    expect(useDriverStore.getState()).toMatchObject({
      quote: QUOTE,
      quoteStatus: "loading",
      quoteError: null,
    });
  });

  it('setQuote("ready", quote) replaces the quote and clears the error', () => {
    useDriverStore.setState({
      quote: QUOTE,
      quoteError: "Couldn't get prices",
    });
    useDriverStore.getState().setQuote("ready", NEWER_QUOTE);
    expect(useDriverStore.getState()).toMatchObject({
      quote: NEWER_QUOTE,
      quoteStatus: "ready",
      quoteError: null,
    });
  });

  it('P3c: setQuote("error", null, message) keeps the previous quote (Book Ride stays mounted) and records the message', () => {
    useDriverStore.setState({ quote: QUOTE, quoteStatus: "loading" });
    useDriverStore.getState().setQuote("error", null, "Couldn't get prices");
    expect(useDriverStore.getState()).toMatchObject({
      quote: QUOTE,
      quoteStatus: "error",
      quoteError: "Couldn't get prices",
    });
  });

  it('P3c: setQuote("error") with no quote yet leaves it null', () => {
    useDriverStore.getState().setQuote("error", null, "Couldn't get prices");
    expect(useDriverStore.getState()).toMatchObject({
      quote: null,
      quoteStatus: "error",
      quoteError: "Couldn't get prices",
    });
  });

  it('setQuote("idle") clears the quote and the error', () => {
    useDriverStore.setState({
      quote: QUOTE,
      quoteError: "Couldn't get prices",
    });
    useDriverStore.getState().setQuote("idle");
    expect(useDriverStore.getState()).toMatchObject({
      quote: null,
      quoteStatus: "idle",
      quoteError: null,
    });
  });

  it("requestQuote asks for a fresh quote by bumping a counter", () => {
    useDriverStore.getState().requestQuote();
    useDriverStore.getState().requestQuote();
    expect(useDriverStore.getState().quoteRequest).toBe(2);
  });
});

describe("the driver store's drivers", () => {
  it("setDrivers, setSelectedDriver and clearSelectedDriver do what they say", () => {
    const store = useDriverStore.getState();
    store.setDrivers([MICHAEL]);
    store.setSelectedDriver(3);
    expect(useDriverStore.getState()).toMatchObject({
      drivers: [MICHAEL],
      selectedDriver: 3,
    });
    store.clearSelectedDriver();
    expect(useDriverStore.getState().selectedDriver).toBeNull();
  });
});

describe("the driver store's driver load (Q5, Q6)", () => {
  it("Q5: starts idle, with no error and no reload asked for", () => {
    expect(useDriverStore.getState()).toMatchObject({
      driversStatus: "idle",
      driversError: null,
      driversRequest: 0,
    });
  });

  it("Q5: setDriversStatus records the load's status and error, and keeps the drivers already placed", () => {
    useDriverStore.setState({ drivers: [MICHAEL] });

    useDriverStore
      .getState()
      .setDriversStatus("error", "Network request failed");

    expect(useDriverStore.getState()).toMatchObject({
      drivers: [MICHAEL],
      driversStatus: "error",
      driversError: "Network request failed",
    });
  });

  it("Q5: a status without an error clears the previous one", () => {
    useDriverStore.setState({
      driversStatus: "error",
      driversError: "Network request failed",
    });

    useDriverStore.getState().setDriversStatus("loading");

    expect(useDriverStore.getState()).toMatchObject({
      driversStatus: "loading",
      driversError: null,
    });
  });

  it("Q5: reloadDrivers asks for the drivers again by bumping a counter", () => {
    useDriverStore.getState().reloadDrivers();
    useDriverStore.getState().reloadDrivers();

    expect(useDriverStore.getState().driversRequest).toBe(2);
  });
});
