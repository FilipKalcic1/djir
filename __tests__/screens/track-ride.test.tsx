/**
 * The tracking screen end to end, from the rider's history (GET /rides, fetch
 * mocked) to the sheet: which ride it shows (T7, T9), its loading and error
 * states, and the Cancel flow of the build plan's WP3 table.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, AlertButton } from "react-native";

import TrackRide from "@/app/(root)/track-ride";
import { ApiError } from "@/services/api";
import { cancelRide } from "@/services/booking";
import { setServerTime } from "@/services/clock";
import { cancelReminder } from "@/services/reminders";
import { Ride } from "@/types/type";

import { settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import { resetClerk } from "../helpers/mocks/clerk";
import {
  resetRouter,
  router,
  useLocalSearchParams,
} from "../helpers/mocks/expo-router";
import { makeRide, MIN } from "../helpers/rides";

jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));
jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("@/services/reminders", () => ({
  syncReminders: jest.fn(async () => {}),
  cancelReminder: jest.fn(async () => {}),
}));
jest.mock("@/services/booking", () => ({ cancelRide: jest.fn() }));
// The layout and the native map are not what this screen test is about.
jest.mock("@/components/RideLayout", () =>
  require("../helpers/mocks/ride-layout"),
);
/** The props track-ride last gave the map. */
const mockMap = { props: null as Record<string, unknown> | null };
jest.mock("@/components/TrackingMap", () => {
  const { View } = jest.requireActual("react-native");
  return function MockTrackingMap(props: Record<string, unknown>) {
    mockMap.props = props;
    return <View testID="tracking-map" />;
  };
});

const NOW = Date.parse("2026-10-03T06:00:00.000Z"); // Saturday 08:00 in Zagreb
const scheduled = makeRide({
  ride_id: 7,
  created_at: new Date(NOW - 60 * MIN).toISOString(),
  paid_at: new Date(NOW - 59 * MIN).toISOString(),
  scheduled_at: "2026-10-04T06:00:00.000Z", // tomorrow 08:00
});
const legacy = makeRide({
  ride_id: 3,
  pickup_minutes: null,
  paid_at: null,
  created_at: "2026-09-12T21:30:00.000Z",
});

const realFetch = global.fetch;
const fetchMock = jest.fn();
const history = (rides: Ride[]) =>
  fetchResponse(200, { data: rides, server_time: new Date(NOW).toISOString() });

async function open(
  rideId: string,
  ...responses: ReturnType<typeof fetchResponse>[]
) {
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  useLocalSearchParams.mockReturnValue({ rideId });
  render(<TrackRide />);
  await settle();
}

/** Tap Cancel ride, then the Alert's button called `choice`, and wait it out. */
async function cancelWith(choice: "Keep ride" | "Cancel ride") {
  const alert = jest.spyOn(Alert, "alert");
  fireEvent.press(screen.getByTestId("ride-cancel"));
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  await act(async () => {
    await buttons.find((b) => b.text === choice)!.onPress?.();
  });
  return alert;
}

/** Tap Cancel ride → Cancel ride, and let what can settle settle (not the whole flow). */
async function startCancel() {
  const alert = jest.spyOn(Alert, "alert");
  fireEvent.press(screen.getByTestId("ride-cancel"));
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  act(() => {
    buttons.find((b) => b.text === "Cancel ride")!.onPress?.();
  });
  await settle();
  return alert;
}

const refunded: Ride = {
  ...scheduled,
  payment_status: "refunded",
  cancelled_at: new Date(NOW).toISOString(),
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetClerk();
  resetRouter();
  setServerTime(new Date(NOW).toISOString(), NOW);
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.mocked(cancelRide).mockReset();
  jest.mocked(cancelReminder).mockClear();
});
afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("which ride", () => {
  it("S1: shows the loading state until the history arrives", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    useLocalSearchParams.mockReturnValue({ rideId: "7" });
    render(<TrackRide />);
    expect(screen.getByTestId("tracking-loading")).toBeOnTheScreen();
  });

  it("S2: a failed history load shows the server's message, and Retry refetches", async () => {
    await open(
      "7",
      fetchResponse(500, { error: "Database unavailable" }),
      history([scheduled]),
    );
    expect(screen.getByTestId("tracking-error")).toHaveTextContent(
      /Database unavailable/,
    );

    fireEvent.press(screen.getByTestId("tracking-retry"));
    await settle();

    expect(screen.getByTestId("tracking-scheduled")).toBeOnTheScreen();
  });

  it("S2: a history with no answer after 10 s shows 'Couldn't load your ride' with the reason and Retry, not an endless spinner", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    useLocalSearchParams.mockReturnValue({ rideId: "7" });
    render(<TrackRide />);
    await settle();
    expect(screen.getByTestId("tracking-loading")).toBeOnTheScreen();

    act(() => jest.advanceTimersByTime(10_000));
    await settle();

    expect(screen.getByTestId("tracking-error")).toHaveTextContent(
      "Couldn't load your rideNo answer from the server. Check your connection and try again.RetryBack Home",
    );
  });

  it.each([
    ["an unknown id", "999"],
    ["another rider's id (history only holds the caller's rides)", "4242"],
  ])("T9: %s shows Ride not found", async (_, rideId) => {
    await open(rideId, history([scheduled]));
    expect(screen.getByTestId("tracking-not-found")).toBeOnTheScreen();
    expect(screen.queryByTestId("tracking-map")).toBeNull();
  });

  it("T7: a ride booked before v1.1 opens as completed, not as 'not found'", async () => {
    await open("3", history([legacy]));
    expect(screen.getByTestId("tracking-completed")).toBeOnTheScreen();
    expect(screen.getByTestId("tracking-headline")).toHaveTextContent(
      "Ride complete",
    );
    expect(screen.queryByTestId("ride-cancel")).toBeNull();
    expect(screen.queryByTestId("tracking-map")).toBeNull(); // nothing to track
  });

  it("MP7: the map is told the sheet rests over 45% of the screen, so it frames the ride above it", async () => {
    await open("7", history([scheduled]));

    expect(screen.getByTestId("tracking-map")).toBeOnTheScreen();
    expect(mockMap.props).toMatchObject({ coveredBottom: 0.45 });
    expect(mockMap.props!.snapshot).toMatchObject({ phase: "scheduled" });
  });

  it("S4: a scheduled ride shows its pickup, the map and a Cancel button", async () => {
    await open("7", history([scheduled]));
    expect(screen.getByTestId("tracking-headline")).toHaveTextContent(
      "Pickup at 08:00",
    );
    expect(screen.getByTestId("tracking-map")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-cancel")).toBeOnTheScreen();
  });
});

describe("leaving the tracker (expo-router 57)", () => {
  it("S4: Back Home pops back to the Home tab — it never pushes a second copy of the tabs over the tracker", async () => {
    await open("7", history([scheduled]));

    fireEvent.press(screen.getByTestId("tracking-back-home"));

    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("the back arrow goes back to the screen below", async () => {
    router.canGoBack.mockReturnValue(true);
    await open("7", history([scheduled]));

    fireEvent.press(screen.getByTestId("ride-layout-back"));

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it("with nothing below (a cold-start deep link or reminder tap), the back arrow goes Home", async () => {
    router.canGoBack.mockReturnValue(false);
    await open("7", history([scheduled]));

    fireEvent.press(screen.getByTestId("ride-layout-back"));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.dismissTo).toHaveBeenCalledWith("/(root)/(tabs)/home");
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe("cancel (WP3 Cancel table)", () => {
  it("X13: asks first: 'Cancel this ride? You'll be refunded €9.74 to your card.' — Keep ride does nothing", async () => {
    await open("7", history([scheduled]));
    const alert = await cancelWith("Keep ride");

    expect(alert.mock.calls[0].slice(0, 2)).toEqual([
      "Cancel this ride?",
      "You'll be refunded €9.74 to your card.",
    ]);
    expect(cancelRide).not.toHaveBeenCalled();
  });

  it("X10 N4: 200 → S9, and the ride's reminder is cancelled", async () => {
    await open("7", history([scheduled]), history([refunded]));
    jest.mocked(cancelRide).mockResolvedValueOnce(refunded);

    await cancelWith("Cancel ride");
    await settle();

    expect(jest.mocked(cancelRide).mock.calls[0][0]).toBe(7);
    expect(cancelReminder).toHaveBeenCalledWith(7);
    expect(screen.getByTestId("tracking-cancelled")).toBeOnTheScreen();
    expect(screen.getByTestId("tracking-detail")).toHaveTextContent(
      "Refund of €9.74 to your card · 5–10 days",
    );
  });

  it("X10: 200 → S9 at once from the cancel response, without waiting for the refetch", async () => {
    await open("7", history([scheduled]));
    fetchMock.mockReturnValueOnce(new Promise(() => {})); // the refetch hangs
    jest.mocked(cancelRide).mockResolvedValueOnce(refunded);

    await startCancel();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("tracking-cancelled")).toBeOnTheScreen();
    expect(screen.getByTestId("tracking-detail")).toHaveTextContent(
      "Refund of €9.74 to your card · 5–10 days",
    );
    expect(screen.queryByTestId("ride-cancel")).toBeNull();
    expect(cancelReminder).toHaveBeenCalledWith(7);
  });

  it("X10 X14: S9 stays even when the refetch after a cancel fails, with no check notice (the cancel route said where it stands)", async () => {
    await open(
      "7",
      history([scheduled]),
      fetchResponse(503, { error: "Service unavailable" }),
    );
    jest.mocked(cancelRide).mockResolvedValueOnce(refunded);

    await cancelWith("Cancel ride");
    await settle();

    expect(screen.getByTestId("tracking-cancelled")).toBeOnTheScreen();
    expect(screen.queryByTestId("tracking-refresh-error")).toBeNull();
  });

  it("X14: when X9's check fails too (still offline), the ride as last loaded says 'Couldn't check your ride' with Retry; Cancel is enabled again, and Retry shows where it stands", async () => {
    await open("7", history([scheduled]));
    fetchMock
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(history([refunded]));
    jest
      .mocked(cancelRide)
      .mockRejectedValueOnce(new TypeError("Network request failed"));

    await cancelWith("Cancel ride");
    await settle();

    expect(screen.getByTestId("tracking-scheduled")).toBeOnTheScreen();
    expect(screen.getByTestId("tracking-refresh-error")).toHaveTextContent(
      "Couldn't check your rideNetwork request failedRetry",
    );
    expect(screen.getByTestId("ride-cancel")).not.toBeDisabled();

    fireEvent.press(screen.getByTestId("tracking-refresh-retry"));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("tracking-cancelled")).toBeOnTheScreen();
    expect(screen.queryByTestId("tracking-refresh-error")).toBeNull();
  });

  it("X13: while the refund is in flight the button is disabled", async () => {
    await open("7", history([scheduled]));
    jest.mocked(cancelRide).mockReturnValueOnce(new Promise(() => {}));
    const alert = jest.spyOn(Alert, "alert");
    fireEvent.press(screen.getByTestId("ride-cancel"));
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    act(() => {
      buttons.find((b) => b.text === "Cancel ride")!.onPress?.();
    });

    expect(screen.getByTestId("ride-cancel")).toBeDisabled();
  });

  it("X11: 409 → the server's reason ('already on the way'), then a refetch", async () => {
    await open("7", history([scheduled]), history([scheduled]));
    const reason =
      "Your driver is already on the way — this ride can no longer be cancelled";
    jest
      .mocked(cancelRide)
      .mockRejectedValueOnce(
        new ApiError(reason, 409, { error: reason, code: "not_cancellable" }),
      );

    const alert = await cancelWith("Cancel ride");

    expect(alert).toHaveBeenLastCalledWith("Couldn't cancel", reason);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cancelReminder).not.toHaveBeenCalled();
  });

  it("X12: 502 → 'We couldn't process the refund. Your ride is still booked — try again.'", async () => {
    await open("7", history([scheduled]), history([scheduled]));
    jest
      .mocked(cancelRide)
      .mockRejectedValueOnce(new ApiError("Stripe is down", 502, null));

    const alert = await cancelWith("Cancel ride");

    expect(alert).toHaveBeenLastCalledWith(
      "Couldn't cancel",
      "We couldn't process the refund. Your ride is still booked — try again.",
    );
    expect(screen.getByTestId("ride-cancel")).not.toBeDisabled();
  });

  it.each([
    ["the connection drops", new TypeError("Network request failed")],
    ["the request times out", new DOMException("Aborted", "AbortError")],
    [
      "the server fails unexpectedly",
      new ApiError("Internal error", 500, { error: "Internal error" }),
    ],
  ])(
    "X9: when %s → 'We couldn't confirm the cancellation. Checking your ride…', then the refetch shows the ride as it stands",
    async (_, failure) => {
      // The refund went through before the answer was lost.
      await open("7", history([scheduled]), history([refunded]));
      jest.mocked(cancelRide).mockRejectedValueOnce(failure);

      const alert = await cancelWith("Cancel ride");
      await settle();

      expect(alert).toHaveBeenLastCalledWith(
        "Cancellation not confirmed",
        "We couldn't confirm the cancellation. Checking your ride…",
      );
      expect(alert).not.toHaveBeenCalledWith(
        "Couldn't cancel",
        expect.stringContaining("still booked"),
      );
      // Said first, then checked: the refetch follows the alert.
      expect(alert.mock.invocationCallOrder[1]).toBeLessThan(
        fetchMock.mock.invocationCallOrder[1],
      );
      expect(screen.getByTestId("tracking-cancelled")).toBeOnTheScreen();
      expect(cancelReminder).not.toHaveBeenCalled();
    },
  );

  it("X9: after a failure Cancel stays disabled until the refetch has settled", async () => {
    let answerRefetch: (r: ReturnType<typeof fetchResponse>) => void = () => {};
    await open("7", history([scheduled]));
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => (answerRefetch = resolve)),
    );
    jest
      .mocked(cancelRide)
      .mockRejectedValueOnce(new TypeError("Network request failed"));

    await startCancel();
    expect(screen.getByTestId("ride-cancel")).toBeDisabled();

    answerRefetch(history([scheduled])); // not cancelled after all
    await settle();

    expect(screen.getByTestId("tracking-scheduled")).toBeOnTheScreen();
    expect(screen.getByTestId("ride-cancel")).not.toBeDisabled();
  });
});
