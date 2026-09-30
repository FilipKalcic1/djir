/**
 * The app's launch with the real Clerk SDK (EG8). Every other client test
 * mocks @clerk/expo; this one loads app/_layout.tsx with the real one, as the
 * app does, and mounts it with a valid key. Loading @clerk/clerk-expo 2.20
 * printed "Clerk - DEPRECATION WARNING", a yellow LogBox toast on every launch
 * in Expo Go; @clerk/expo prints nothing as it loads.
 *
 * The runtime is Expo Go's: Clerk's optional native module (ClerkExpo) is
 * absent, as the Expo Go app ships without it, and there is no
 * BroadcastChannel, which Hermes lacks and clerk-js would otherwise open as it
 * loads (Node has one, and it would keep Jest running). Clerk's Frontend API
 * never answers, so ClerkLoaded keeps the stack back; or it can't be reached
 * at all, as offline, and the root says so instead of staying blank.
 * Native-only modules the layout calls as it loads are stubbed as in
 * screens/root-layout.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { requireOptionalNativeModule } from "expo";
import { LogBox } from "react-native";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));
jest.mock("expo-notifications", () =>
  require("../helpers/mocks/expo-notifications"),
);
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

type Logged = [level: "warn" | "error", message: string];

/** Records console warnings and errors (what LogBox shows) until `stop()`. */
function recordConsole() {
  const logged: Logged[] = [];
  const spies = (["warn", "error"] as const).map((level) =>
    jest
      .spyOn(console, level)
      .mockImplementation((...args: unknown[]) =>
        logged.push([level, args.map(String).join(" ")]),
      ),
  );
  return { logged, stop: () => spies.forEach((spy) => spy.mockRestore()) };
}

/** A publishable key for the Frontend API `host`, built the way Clerk builds one. */
const CLERK_KEY = `pk_test_${btoa("clever-cat-12.clerk.accounts.dev$")}`;

/** The URL a `fetch` was called with, whether as a string, a URL or a Request. */
const urlOf = (input: RequestInfo | URL) =>
  typeof input === "object" && "url" in input ? input.url : String(input);

/** What Clerk's Frontend API answers a native client that has no session yet. */
function frontendApiAnswer(url: string) {
  const { pathname } = new URL(url);
  const body =
    pathname === "/v1/environment"
      ? {
          object: "environment",
          id: "env_1",
          auth_config: {
            object: "auth_config",
            id: "aac_1",
            single_session_mode: true,
          },
          display_config: {
            object: "display_config",
            id: "display_config_1",
            instance_environment_type: "development",
          },
          user_settings: {},
          organization_settings: {},
        }
      : { response: null, client: null }; // /v1/client: signed out
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// The layout loads once, here, the way the app loads it at launch.
const ignoreLogs = jest.spyOn(LogBox, "ignoreLogs");
const loading = recordConsole();
const withBroadcastChannel = globalThis as { BroadcastChannel?: unknown };
const broadcastChannel = withBroadcastChannel.BroadcastChannel;
delete withBroadcastChannel.BroadcastChannel;
let RootLayout: typeof import("@/app/_layout").default;
try {
  RootLayout = require("@/app/_layout").default;
} finally {
  withBroadcastChannel.BroadcastChannel = broadcastChannel;
  loading.stop();
}
const ignoredByRoot = ignoreLogs.mock.calls.map(([patterns]) => patterns);
ignoreLogs.mockRestore();

describe("the app's launch with the real Clerk SDK (EG8)", () => {
  const savedKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  afterEach(() => {
    if (savedKey === undefined)
      delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    else process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = savedKey;
    jest.restoreAllMocks();
  });

  it("EG8: loading the app root, and with it the real @clerk/expo, logs no warning or error: no Clerk deprecation toast", () => {
    expect(typeof RootLayout).toBe("function");
    expect(loading.logged).toEqual([]);
  });

  it("EG8: with a valid key the real ClerkProvider starts without Clerk's native module, as in Expo Go, loads from the key's Frontend API as a native client, and logs only Clerk's development-keys notice, which the root keeps out of LogBox", async () => {
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = CLERK_KEY;
    const requests: string[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation((input) => {
      requests.push(urlOf(input));
      return new Promise<Response>(() => {}); // Clerk never answers
    });
    const mounting = recordConsole();

    const view = render(<RootLayout />);
    await waitFor(() => expect(requests).toHaveLength(2));
    await act(async () => {});
    mounting.stop();

    expect(requireOptionalNativeModule("ClerkExpo")).toBeNull();
    expect(screen.getByTestId("gesture-root")).toBeOnTheScreen();
    expect(screen.queryByTestId("setup-needed")).toBeNull();
    expect(screen.queryByTestId("stack")).toBeNull();
    expect(
      requests.map((url) => {
        const { origin, pathname, searchParams } = new URL(url);
        return [`${origin}${pathname}`, searchParams.get("_is_native")];
      }),
    ).toEqual([
      ["https://clever-cat-12.clerk.accounts.dev/v1/environment", "1"],
      ["https://clever-cat-12.clerk.accounts.dev/v1/client", "1"],
    ]);
    expect(mounting.logged).toEqual([
      [
        "warn",
        expect.stringMatching(
          /^Clerk: Clerk has been loaded with development keys\. /,
        ),
      ],
    ]);
    expect(ignoredByRoot).toEqual([["Clerk:"]]);

    view.unmount();
  });

  it("EG8: when Clerk can't be reached at launch, the root says so with Retry instead of staying blank; Retry loads Clerk again, busy until it answers, and then the app starts", async () => {
    // Offline, @clerk/clerk-js 6 gives up after four tries of each request
    // (about 3.5 s) and never tries again by itself; 2.20 loaded anyway.
    jest.useFakeTimers();
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = CLERK_KEY;
    let online = false;
    const requests: string[] = [];
    const answers: (() => void)[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = urlOf(input);
      requests.push(new URL(url).pathname);
      if (!online)
        return Promise.reject(new TypeError("Network request failed"));
      return new Promise<Response>((resolve) =>
        answers.push(() => resolve(frontendApiAnswer(url))),
      );
    });
    const mounting = recordConsole();

    try {
      const view = render(<RootLayout />);
      await act(() => jest.advanceTimersByTimeAsync(10_000));

      expect(screen.getByTestId("clerk-unreachable")).toHaveTextContent(
        "Can't connectDjir couldn't reach its sign-in service. Check your internet connection and try again.Retry",
      );
      expect(screen.getByTestId("clerk-retry")).toBeEnabled();
      expect(screen.queryByTestId("stack")).toBeNull();
      expect([...new Set(requests)]).toEqual(["/v1/environment", "/v1/client"]);
      expect(requests).toHaveLength(8);
      await act(() => jest.advanceTimersByTimeAsync(60_000));
      expect(requests).toHaveLength(8); // nothing tries again by itself

      // Retry while still offline: busy through Clerk's four tries, then back.
      await act(async () => {
        fireEvent.press(screen.getByTestId("clerk-retry"));
      });
      expect(screen.getByTestId("clerk-retry")).toBeBusy();
      await act(() => jest.advanceTimersByTimeAsync(10_000));
      expect(requests).toHaveLength(16);
      expect(screen.getByTestId("clerk-retry")).toBeEnabled();
      expect(screen.queryByTestId("stack")).toBeNull();

      online = true;
      requests.length = 0;
      await act(async () => {
        fireEvent.press(screen.getByTestId("clerk-retry"));
      });

      expect(requests).toEqual(["/v1/environment", "/v1/client"]);
      expect(screen.getByTestId("clerk-retry")).toBeBusy();
      expect(screen.queryByTestId("stack")).toBeNull();

      await act(async () => {
        answers.forEach((answer) => answer());
      });

      expect(screen.getByTestId("stack")).toBeOnTheScreen();
      expect(screen.queryByTestId("clerk-unreachable")).toBeNull();
      expect(mounting.logged.filter(([level]) => level === "error")).toEqual(
        [],
      );
      view.unmount();
    } finally {
      mounting.stop();
      jest.useRealTimers();
    }
  });
});
