/**
 * services/setup — the app's EXPO_PUBLIC_* keys as the bundle holds them
 * (EG1), and the API's own report of its settings (EG3). Only `fetch` is
 * faked; responses are real `Response` objects, and the real fetchAPI and
 * lib/setup run.
 */
import { TIMEOUT_MESSAGE } from "@/services/api";
import {
  appKeyValues,
  fetchServerHealth,
  HEALTH_TIMEOUT_MS,
  NOT_A_HEALTH_REPORT,
} from "@/services/setup";

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const reply = (
  status: number,
  body: string,
  contentType = "application/json",
) =>
  fetchMock.mockResolvedValueOnce(
    new Response(body, { status, headers: { "Content-Type": contentType } }),
  );

const KEYS = [
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_PLACES_API_KEY",
  "EXPO_PUBLIC_DIRECTIONS_API_KEY",
  "EXPO_PUBLIC_GEOAPIFY_API_KEY",
];

let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  savedEnv = process.env;
  process.env = { ...savedEnv };
  for (const key of KEYS) delete process.env[key];
  fetchMock.mockReset();
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((url, init) => fetchMock(url as string, init!));
});
afterEach(() => {
  process.env = savedEnv;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("appKeyValues", () => {
  it("EG1: reads each EXPO_PUBLIC_* key the app uses, unset ones as undefined", () => {
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_clerk";
    process.env.EXPO_PUBLIC_PLACES_API_KEY = "";

    expect(appKeyValues()).toEqual({
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
      EXPO_PUBLIC_PLACES_API_KEY: "",
      EXPO_PUBLIC_DIRECTIONS_API_KEY: undefined,
      EXPO_PUBLIC_GEOAPIFY_API_KEY: undefined,
    });
  });

  it("EG1: reads every key by its own name", () => {
    for (const key of KEYS) process.env[key] = `value of ${key}`;

    expect(appKeyValues()).toEqual(
      Object.fromEntries(KEYS.map((key) => [key, `value of ${key}`])),
    );
  });
});

describe("fetchServerHealth", () => {
  it("EG3: asks GET /(api)/health, app-relative, with no session", async () => {
    reply(200, '{"ok":true,"missing":[]}');

    await expect(fetchServerHealth()).resolves.toEqual({
      reachable: true,
      missing: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/(api)/health");
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it("EG3: passes on the settings the API names as missing", async () => {
    reply(
      200,
      '{"ok":false,"missing":["DATABASE_URL","QUOTE_SIGNING_SECRET"]}',
    );

    await expect(fetchServerHealth()).resolves.toEqual({
      reachable: true,
      missing: ["DATABASE_URL", "QUOTE_SIGNING_SECRET"],
    });
  });

  it("EG3: a network failure means the API is unreachable, with the reason", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));

    await expect(fetchServerHealth()).resolves.toEqual({
      reachable: false,
      reason: "Network request failed",
    });
  });

  it("EG3: an error status is unreachable too, with the status", async () => {
    reply(404, "<html>Not found</html>", "text/html");

    await expect(fetchServerHealth()).resolves.toEqual({
      reachable: false,
      reason: "Request failed (HTTP 404)",
    });
  });

  it("EG3: an answer that is not a health report is not taken for one", async () => {
    reply(200, "<!DOCTYPE html><html></html>", "text/html");

    await expect(fetchServerHealth()).resolves.toEqual({
      reachable: false,
      reason: NOT_A_HEALTH_REPORT,
    });
  });

  it("EG3: a failure without a message still gives a reason", async () => {
    fetchMock.mockRejectedValueOnce({});

    await expect(fetchServerHealth()).resolves.toEqual({
      reachable: false,
      reason: "The request failed.",
    });
  });

  it("EG3: no answer within HEALTH_TIMEOUT_MS is unreachable, never an endless check", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));

    const health = fetchServerHealth();
    await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);

    await expect(health).resolves.toEqual({
      reachable: false,
      reason: TIMEOUT_MESSAGE,
    });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
