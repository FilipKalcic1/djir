/**
 * The app's two layouts.
 *
 * app/_layout.tsx, the root: without a valid Clerk publishable key it shows
 * "Setup needed" instead of crashing (EG1); everything sits in one
 * GestureHandlerRootView and the splash screen waits for the fonts (EG7); a
 * reminder that fires while the app is open is shown (N1). Fonts, the splash
 * screen and the gesture root are stubbed at the native boundary; ClerkProvider
 * records its props; the real "Setup needed" screen asks a faked `fetch`.
 *
 * app/(root)/_layout.tsx, reminder taps (N5): a tapped ride reminder opens
 * that ride's tracker, once. The OS keeps the last tap — through a JS reload
 * too — and expo-notifications' useLastNotificationResponse hands it to every
 * new mount (a sign-out and sign-in), so the layout clears a tap it acted on.
 * Navigation and notifications are the shared mocks (the latter keeps the OS's
 * last tap); the booking data hook is not what this test is about.
 */
import { ClerkProvider } from "@clerk/clerk-expo";
import { act, render, screen } from "@testing-library/react-native";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";

import Layout from "@/app/(root)/_layout";
import RootLayout from "@/app/_layout";
import { tokenCache } from "@/services/auth";

import { settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
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

// The shared Clerk mock, plus a provider that records its props.
jest.mock("@clerk/clerk-expo", () => {
  const { createElement } = require("react");
  const { View } = require("react-native");
  return {
    ...require("../helpers/mocks/clerk"),
    ClerkProvider: jest.fn(({ children }) =>
      createElement(View, { testID: "clerk-provider" }, children),
    ),
    ClerkLoaded: ({ children }: { children: unknown }) => children,
  };
});
jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("expo-notifications", () =>
  require("../helpers/mocks/expo-notifications"),
);
jest.mock("@/hooks/useDriverQuotes", () => ({ useDriverQuotes: jest.fn() }));
jest.mock("expo-font", () => ({ useFonts: jest.fn(() => [true, null]) }));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => {}),
}));
jest.mock("react-native-reanimated", () => ({}));
jest.mock("react-native-gesture-handler", () => {
  const { createElement } = require("react");
  const { View } = require("react-native");
  return {
    GestureHandlerRootView: (props: object) =>
      createElement(View, { testID: "gesture-root", ...props }),
  };
});
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

// Called once, when app/_layout.tsx is first imported (before any beforeEach).
const notificationHandler = jest.mocked(Notifications.setNotificationHandler)
  .mock.calls[0]?.[0];
const splashHeldAtImport = jest.mocked(SplashScreen.preventAutoHideAsync).mock
  .calls.length;

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

/** A publishable key for the Frontend API `host`, built the way Clerk builds one. */
const CLERK_KEY = `pk_test_${btoa("clever-cat-12.clerk.accounts.dev$")}`;

describe("app root layout — keys, gesture root, splash (EG1, EG7)", () => {
  // Set on process.env itself: in the client project the app reads its
  // EXPO_PUBLIC_* keys through expo/virtual/env, which holds that object.
  const savedKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const fontsLoad = (result: [boolean, Error | null]) =>
    jest.mocked(useFonts).mockReturnValue(result);

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    fontsLoad([true, null]);
    jest.mocked(ClerkProvider).mockClear();
    jest.mocked(SplashScreen.hideAsync).mockClear();
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        fetchResponse(200, {
          ok: false,
          missing: ["DATABASE_URL"],
        }) as unknown as Response,
    );
  });
  afterEach(() => {
    if (savedKey === undefined)
      delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    else process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = savedKey;
    jest.restoreAllMocks();
  });

  it("EG1: without EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY the app shows Setup needed instead of crashing, and never starts Clerk", async () => {
    expect(() => render(<RootLayout />)).not.toThrow();
    await settle();

    expect(screen.getByTestId("setup-needed")).toBeOnTheScreen();
    expect(
      screen.getByTestId("setup-key-EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY-status"),
    ).toHaveTextContent("Required · Missing");
    expect(
      screen.getByTestId("setup-server-DATABASE_URL-status"),
    ).toHaveTextContent("Missing");
    expect(ClerkProvider).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stack")).toBeNull();
  });

  it("EG1: a Clerk key ClerkProvider would refuse shows Setup needed too, marked not valid", async () => {
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_xxx";

    render(<RootLayout />);
    await settle();

    expect(
      screen.getByTestId("setup-key-EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY-status"),
    ).toHaveTextContent("Required · Not a valid key");
    expect(ClerkProvider).not.toHaveBeenCalled();
  });

  it("EG1: a valid key starts Clerk with that key and the SecureStore token cache, around the app's stack", () => {
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = CLERK_KEY;

    render(<RootLayout />);

    expect(ClerkProvider).toHaveBeenCalledTimes(1);
    expect(jest.mocked(ClerkProvider).mock.calls[0][0]).toMatchObject({
      publishableKey: CLERK_KEY,
      tokenCache,
    });
    expect(screen.getByTestId("stack")).toBeOnTheScreen();
    expect(screen.queryByTestId("setup-needed")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["with the Clerk key", CLERK_KEY, "clerk-provider"],
    ["without it", undefined, "setup-needed"],
  ])(
    "EG7: %s, everything sits in one GestureHandlerRootView filling the screen (bottom-sheet v5)",
    async (_, key, content) => {
      if (key) process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = key;

      render(<RootLayout />);
      await settle();

      const root = screen.getByTestId("gesture-root");
      expect(root).toHaveStyle({ flex: 1 });
      expect(screen.getAllByTestId("gesture-root")).toHaveLength(1);
      expect(root).toContainElement(screen.getByTestId(content));
    },
  );

  it("EG7: the splash screen is held from import, nothing renders until the fonts load, and then it hides", () => {
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = CLERK_KEY;
    fontsLoad([false, null]);

    render(<RootLayout />);

    expect(splashHeldAtImport).toBe(1);
    expect(screen.toJSON()).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    fontsLoad([true, null]);
    screen.rerender(<RootLayout />);

    expect(screen.getByTestId("stack")).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it("EG7: a font that fails to load still starts the app, on the system font, and hides the splash", () => {
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = CLERK_KEY;
    fontsLoad([false, new Error("Font file missing")]);

    render(<RootLayout />);

    expect(screen.getByTestId("stack")).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it("N1: a reminder that fires while the app is open is shown as a banner and in the list, with its sound", async () => {
    expect(notificationHandler).toBeDefined();

    await expect(
      notificationHandler!.handleNotification({} as Notifications.Notification),
    ).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
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
