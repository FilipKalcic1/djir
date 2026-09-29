/**
 * The (root) layout's reminder taps (N5): a tapped ride reminder opens that
 * ride's tracker, once. The OS keeps the last tap — through a JS reload too —
 * and expo-notifications' useLastNotificationResponse hands it to every new
 * mount (a sign-out and sign-in), so the layout clears a tap it acted on.
 * Navigation and notifications are the shared mocks (the latter keeps the OS's
 * last tap); the booking data hook is not what this test is about.
 */
import { act, render, screen } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import Layout from "@/app/(root)/_layout";

import { auth, resetClerk } from "../helpers/mocks/clerk";
import {
  lastTap,
  receiveTap,
  resetNotifications,
  tapResponse,
} from "../helpers/mocks/expo-notifications";
import {
  resetRouter,
  router,
  useGlobalSearchParams,
  usePathname,
} from "../helpers/mocks/expo-router";

jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));
jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("expo-notifications", () =>
  require("../helpers/mocks/expo-notifications"),
);
jest.mock("@/hooks/useDriverQuotes", () => ({ useDriverQuotes: jest.fn() }));

const clearTap = jest.mocked(Notifications.clearLastNotificationResponseAsync);
const DELIVERED = Date.parse("2026-10-04T05:43:00.000Z");

/** The reminder `ride-{rideId}` as the rider tapped it. */
const reminderTap = (rideId: number) =>
  tapResponse(`ride-${rideId}`, DELIVERED, { rideId });
/** The rider tapped it before the app opened: the OS holds it as the last tap. */
const tappedBeforeLaunch = (rideId: number) => {
  lastTap.current = reminderTap(rideId);
};
const trackerOf = (rideId: string) => ({
  pathname: "/(root)/track-ride",
  params: { rideId },
});

beforeEach(() => {
  resetClerk();
  resetRouter();
  resetNotifications();
});

describe("(root) layout — reminder taps (N5)", () => {
  it("N5: a tapped reminder opens that ride's tracker", () => {
    tappedBeforeLaunch(42);

    render(<Layout />);

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(trackerOf("42"));
    expect(screen.getByTestId("stack")).toBeOnTheScreen();
  });

  it("N5: a tap acted on is cleared from the OS, so a reload — which reads the OS's last tap — replays nothing", () => {
    tappedBeforeLaunch(42);

    render(<Layout />);

    expect(clearTap).toHaveBeenCalledTimes(1);
    expect(lastTap.current).toBeNull();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("N5: mounting twice after the same tap opens the tracker once", () => {
    tappedBeforeLaunch(42);

    render(<Layout />).unmount();
    render(<Layout />);

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("N5: after a sign-out and sign-in the old tap does not reopen the tracker", () => {
    tappedBeforeLaunch(42);
    const { rerender } = render(<Layout />);

    auth.isSignedIn = false;
    rerender(<Layout />); // the gate unmounts the (root) tree
    expect(screen.getByTestId("redirect")).toHaveTextContent("/(auth)/welcome");
    auth.isSignedIn = true;
    rerender(<Layout />); // …and mounts it again

    expect(screen.getByTestId("stack")).toBeOnTheScreen();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("N5: a new tap while the app runs opens its own ride", () => {
    tappedBeforeLaunch(42);
    render(<Layout />);

    act(() => receiveTap(reminderTap(43)));

    expect(jest.mocked(router.push).mock.calls).toEqual([
      [trackerOf("42")],
      [trackerOf("43")],
    ]);
    expect(clearTap).toHaveBeenCalledTimes(2);
  });

  it("N5: the launch tap handed over again by the SDK's listener, after it was cleared, opens nothing more", () => {
    tappedBeforeLaunch(42);
    render(<Layout />);

    act(() => receiveTap(reminderTap(42)));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(clearTap).toHaveBeenCalledTimes(1);
  });

  it("N5: a tap on the reminder of the ride whose tracker is on screen opens no second tracker", () => {
    usePathname.mockReturnValue("/track-ride");
    useGlobalSearchParams.mockReturnValue({ rideId: "42" });
    render(<Layout />);

    act(() => receiveTap(reminderTap(42)));
    act(() => receiveTap(reminderTap(43)));

    expect(jest.mocked(router.push).mock.calls).toEqual([[trackerOf("43")]]);
    expect(clearTap).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["no tap", null],
    [
      "a notification that is not a ride reminder",
      tapResponse("promo-weekend", DELIVERED, { url: "djir://home" }),
    ],
  ])("N5: %s opens nothing, and is left to whoever handles it", (_, tap) => {
    lastTap.current = tap;

    render(<Layout />);

    expect(screen.getByTestId("stack")).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();
    expect(clearTap).not.toHaveBeenCalled();
  });

  it("R53 N5: signed out, the layout redirects and opens no ride", () => {
    auth.isSignedIn = false;
    tappedBeforeLaunch(42);

    render(<Layout />);

    expect(screen.getByTestId("redirect")).toHaveTextContent("/(auth)/welcome");
    expect(screen.queryByTestId("stack")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});
