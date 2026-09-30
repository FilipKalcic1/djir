/**
 * "Setup needed": what the app shows instead of crashing when a required key
 * is missing (EG1), with the API's own view of its settings (EG3). The real
 * lib/setup and services/setup run; only `fetch` is faked.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";

import SetupNeeded from "@/components/SetupNeeded";
import { AppKeyValues, checkAppKeys } from "@/lib/setup";

import { deferred, settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import { colors } from "../helpers/tokens";

// The library's own jest mock (a default export): no native insets in Jest.
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);

const NOTHING_SET: AppKeyValues = {};
const SERVER = [
  "DATABASE_URL",
  "CLERK_JWT_KEY",
  "QUOTE_SIGNING_SECRET",
  "STRIPE_SECRET_KEY",
];

const fetchMock = jest.fn();
const healthAnswers = (missing: string[]) =>
  fetchMock.mockResolvedValue(
    fetchResponse(200, { ok: missing.length === 0, missing }),
  );

function renderSetup(values: AppKeyValues = NOTHING_SET) {
  render(<SetupNeeded checks={checkAppKeys(values)} />);
}
const keyStatus = (name: string) =>
  screen.getByTestId(`setup-key-${name}-status`);
const serverStatus = (name: string) =>
  screen.getByTestId(`setup-server-${name}-status`);

beforeEach(() => {
  fetchMock.mockReset();
  healthAnswers(SERVER);
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
});
afterEach(() => jest.restoreAllMocks());

describe("SetupNeeded — app keys (EG1)", () => {
  it("EG1: says the app can't start and where the keys go", async () => {
    renderSetup();
    await settle();

    expect(screen.getByTestId("setup-needed")).toBeOnTheScreen();
    expect(screen.getByRole("header")).toHaveTextContent("Setup needed");
    expect(
      screen.getByText(
        "Djir can't start yet. Add the missing keys to .env.local in the project folder, then stop npx expo start and run it again.",
      ),
    ).toBeOnTheScreen();
  });

  it("EG1: lists every EXPO_PUBLIC_* key: the Clerk key required, the others optional with what they unlock", async () => {
    renderSetup();
    await settle();

    expect(keyStatus("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY")).toHaveTextContent(
      "Required · Missing",
    );
    for (const name of [
      "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_PLACES_API_KEY",
      "EXPO_PUBLIC_DIRECTIONS_API_KEY",
      "EXPO_PUBLIC_GEOAPIFY_API_KEY",
    ]) {
      expect(keyStatus(name)).toHaveTextContent("Optional · Missing");
    }
    const stripe = screen.getByTestId(
      "setup-key-EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    );
    expect(
      within(stripe).getByText(
        "Paying for a ride (Confirm Ride / Schedule Ride).",
      ),
    ).toBeOnTheScreen();
    const places = screen.getByTestId("setup-key-EXPO_PUBLIC_PLACES_API_KEY");
    expect(
      within(places).getByText("Searching the From and To addresses."),
    ).toBeOnTheScreen();
    expect(
      within(
        screen.getByTestId("setup-key-EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"),
      ).getByText("Clerk dashboard → API Keys → Publishable key (pk_test_…)."),
    ).toBeOnTheScreen();
  });

  it("EG1: a required key that is missing is red; an optional one is amber; a set one is green and says no more", async () => {
    renderSetup({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      EXPO_PUBLIC_PLACES_API_KEY: "AIza-places",
    });
    await settle();

    expect(keyStatus("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY")).toHaveTextContent(
      "Required · Not a valid key",
    );
    expect(keyStatus("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY")).toHaveStyle({
      color: colors.danger["700"],
    });
    expect(keyStatus("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY")).toHaveStyle({
      color: colors.warning["700"],
    });
    expect(keyStatus("EXPO_PUBLIC_PLACES_API_KEY")).toHaveTextContent(
      "Optional · Set",
    );
    expect(keyStatus("EXPO_PUBLIC_PLACES_API_KEY")).toHaveStyle({
      color: colors.success["700"],
    });
    expect(
      within(
        screen.getByTestId("setup-key-EXPO_PUBLIC_PLACES_API_KEY"),
      ).queryByText("Google Cloud console → Places API key."),
    ).toBeNull();
  });

  it("EG1: never shows a key's value", async () => {
    renderSetup({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_not-a-real-key",
      EXPO_PUBLIC_PLACES_API_KEY: "AIza-places-secret-value",
    });
    await settle();

    expect(screen.queryByText(/not-a-real-key/)).toBeNull();
    expect(screen.queryByText(/places-secret-value/)).toBeNull();
  });
});

describe("SetupNeeded — server settings from /(api)/health (EG3)", () => {
  it("EG3: asks /(api)/health once, showing that it is checking until the answer", async () => {
    const answer = deferred<ReturnType<typeof fetchResponse>>();
    fetchMock.mockReset().mockReturnValueOnce(answer.promise);
    renderSetup();

    expect(screen.getByTestId("setup-server-checking")).toHaveTextContent(
      "Checking the API…",
    );
    expect(screen.getByTestId("setup-check-again")).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/(api)/health");

    await act(async () =>
      answer.resolve(fetchResponse(200, { ok: true, missing: [] })),
    );

    expect(screen.queryByTestId("setup-server-checking")).toBeNull();
    expect(screen.getByTestId("setup-check-again")).toBeEnabled();
  });

  it("EG3: names each missing server setting, with what it is for, and marks the others set", async () => {
    healthAnswers(["DATABASE_URL", "QUOTE_SIGNING_SECRET"]);
    renderSetup();
    await settle();

    expect(serverStatus("DATABASE_URL")).toHaveTextContent("Missing");
    expect(serverStatus("DATABASE_URL")).toHaveStyle({
      color: colors.danger["700"],
    });
    expect(serverStatus("QUOTE_SIGNING_SECRET")).toHaveTextContent("Missing");
    expect(serverStatus("CLERK_JWT_KEY")).toHaveTextContent("Set");
    expect(serverStatus("STRIPE_SECRET_KEY")).toHaveTextContent("Set");
    expect(
      within(screen.getByTestId("setup-server-QUOTE_SIGNING_SECRET")).getByText(
        "Prices: any random string of at least 32 characters (openssl rand -hex 32).",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("setup-server-ok")).toBeNull();
  });

  it("EG3: says so when the API is reachable and nothing is missing", async () => {
    healthAnswers([]);
    renderSetup();
    await settle();

    expect(screen.getByTestId("setup-server-ok")).toHaveTextContent(
      "The API is reachable and every server setting is set.",
    );
    for (const name of SERVER) {
      expect(serverStatus(name)).toHaveTextContent("Set");
    }
  });

  it("EG3: an API the phone cannot reach is said so, with the reason and what to check", async () => {
    fetchMock
      .mockReset()
      .mockRejectedValue(new TypeError("Network request failed"));
    renderSetup();
    await settle();

    const unreachable = screen.getByTestId("setup-server-unreachable");
    expect(
      within(unreachable).getByText(
        "The API is not reachable: Network request failed",
      ),
    ).toHaveStyle({ color: colors.danger["700"] });
    expect(
      within(unreachable).getByText(
        "Keep npx expo start running on your computer, with the phone on the same Wi-Fi network, then tap Check again.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("setup-server-DATABASE_URL")).toBeNull();
  });

  it("EG3: Check again asks the API again and shows the new answer", async () => {
    fetchMock
      .mockReset()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(
        fetchResponse(200, { ok: false, missing: ["STRIPE_SECRET_KEY"] }),
      );
    renderSetup();
    await settle();
    expect(screen.getByTestId("setup-server-unreachable")).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId("setup-check-again"));
    expect(screen.getByTestId("setup-server-checking")).toBeOnTheScreen();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("setup-server-unreachable")).toBeNull();
    expect(serverStatus("STRIPE_SECRET_KEY")).toHaveTextContent("Missing");
    expect(serverStatus("DATABASE_URL")).toHaveTextContent("Set");
  });
});
