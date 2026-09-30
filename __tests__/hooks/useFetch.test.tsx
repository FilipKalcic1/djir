import { act, renderHook } from "@testing-library/react-native";

import { useFetch } from "@/hooks/useFetch";
import { TIMEOUT_MESSAGE } from "@/services/api";

import { settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import * as clerk from "../helpers/mocks/clerk";
import { auth, resetClerk } from "../helpers/mocks/clerk";

jest.mock("@clerk/expo", () => require("../helpers/mocks/clerk"));

type Body = { data: string[]; server_time?: string };

/** Every fetch stays pending until the test answers it, in any order. */
const requests: {
  url: string;
  init: RequestInit;
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
}[] = [];
const fetchMock = jest.fn(
  (url: string, init: RequestInit) =>
    new Promise((resolve, reject) =>
      requests.push({ url, init, resolve, reject }),
    ),
);

async function answer(index: number, status: number, body: unknown) {
  requests[index].resolve(fetchResponse(status, body));
  await settle();
}

async function fail(index: number, error: Error) {
  requests[index].reject(error);
  await settle();
}

const state = (result: {
  current: ReturnType<typeof useFetch<string[], Body>>;
}) => {
  const { data, body, loading, error } = result.current;
  return { data, body, loading, error };
};

beforeEach(() => {
  resetClerk();
  requests.length = 0;
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => jest.restoreAllMocks());

describe("useFetch", () => {
  it("R40: a null url makes no request and is not loading", async () => {
    const { result } = renderHook(() => useFetch<string[], Body>(null));

    await act(() => result.current.refetch());
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: false,
      error: null,
    });
  });

  it("R40: loads the url without a token: loading, then the body and its data", async () => {
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/driver"),
    );
    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: true,
      error: null,
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/(api)/driver", { headers: {} });
    expect(auth.getToken).not.toHaveBeenCalled();

    await answer(0, 200, {
      data: ["a", "b"],
      server_time: "2026-10-03T19:00:00.000Z",
    });

    expect(state(result)).toEqual({
      data: ["a", "b"],
      body: { data: ["a", "b"], server_time: "2026-10-03T19:00:00.000Z" },
      loading: false,
      error: null,
    });
  });

  it("R40: an authenticated request sends a fresh Clerk session token every time", async () => {
    auth.getToken
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides", { authenticated: true }),
    );
    await settle();
    await answer(0, 200, { data: ["first"] });

    await act(() => {
      result.current.refetch();
    });
    await settle();

    expect(auth.getToken).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls).toEqual([
      ["/(api)/rides", { headers: { Authorization: "Bearer token-1" } }],
      ["/(api)/rides", { headers: { Authorization: "Bearer token-2" } }],
    ]);
  });

  it("R40: a server error shows the server's message and stops loading", async () => {
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides"),
    );
    await settle();

    await answer(0, 500, { error: "Database unavailable" });

    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: false,
      error: "Database unavailable",
    });
  });

  it("R40: a network failure shows its message", async () => {
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides"),
    );
    await settle();

    await fail(0, new TypeError("Network request failed"));

    expect(result.current.error).toBe("Network request failed");
    expect(result.current.loading).toBe(false);
  });

  it("R40: a session token that cannot be read is an error, and nothing is sent", async () => {
    auth.getToken.mockRejectedValueOnce(new Error("Session expired"));

    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides", { authenticated: true }),
    );
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Session expired");
    expect(result.current.loading).toBe(false);
  });

  it("R40: refetch clears the error, loads again and shows the new data", async () => {
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides"),
    );
    await settle();
    await answer(0, 500, { error: "Database unavailable" });

    await act(() => {
      result.current.refetch();
    });
    await settle();
    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: true,
      error: null,
    });
    await answer(1, 200, { data: ["fresh"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state(result)).toEqual({
      data: ["fresh"],
      body: { data: ["fresh"] },
      loading: false,
      error: null,
    });
  });

  it("R40: refetch keeps the loaded data on screen while it reloads (pull-to-refresh)", async () => {
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides"),
    );
    await settle();
    await answer(0, 200, { data: ["old"] });

    await act(() => {
      result.current.refetch();
    });
    await settle();
    expect(result.current.data).toEqual(["old"]);
    expect(result.current.loading).toBe(true);

    await answer(1, 200, { data: ["new"] });
    expect(result.current.data).toEqual(["new"]);
    expect(result.current.loading).toBe(false);
  });

  it.each([
    ["before", [0, 1]],
    ["after", [1, 0]],
  ])(
    "R40: when the url changes mid-flight, the outdated response is dropped (it arrives %s the current one)",
    async (_, order) => {
      const { result, rerender } = renderHook(
        ({ url }: { url: string }) => useFetch<string[], Body>(url),
        { initialProps: { url: "/(api)/rides?page=1" } },
      );
      await settle();
      rerender({ url: "/(api)/rides?page=2" });
      await settle();
      expect(requests.map((r) => r.url)).toEqual([
        "/(api)/rides?page=1",
        "/(api)/rides?page=2",
      ]);
      const bodies = [{ data: ["page 1"] }, { data: ["page 2"] }];

      await answer(order[0], 200, bodies[order[0]]);
      await answer(order[1], 200, bodies[order[1]]);

      expect(state(result)).toEqual({
        data: ["page 2"],
        body: { data: ["page 2"] },
        loading: false,
        error: null,
      });
    },
  );

  it("R40: an outdated response arriving first neither shows its data nor ends the loading", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useFetch<string[], Body>(url),
      { initialProps: { url: "/(api)/rides?page=1" } },
    );
    await settle();
    rerender({ url: "/(api)/rides?page=2" });
    await settle();

    await answer(0, 200, { data: ["page 1"] });

    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: true,
      error: null,
    });
  });

  it("R40: an outdated request's failure is dropped too", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useFetch<string[], Body>(url),
      { initialProps: { url: "/(api)/rides?page=1" } },
    );
    await settle();
    rerender({ url: "/(api)/rides?page=2" });
    await settle();

    await fail(0, new TypeError("Network request failed"));
    expect(result.current.error).toBeNull();
    await answer(1, 200, { data: ["page 2"] });

    expect(state(result)).toEqual({
      data: ["page 2"],
      body: { data: ["page 2"] },
      loading: false,
      error: null,
    });
  });

  it("R40: a url that becomes known later (sign-in) starts loading then", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useFetch<string[], Body>(url),
      { initialProps: { url: null as string | null } },
    );
    expect(result.current.loading).toBe(false);

    rerender({ url: "/(api)/rides" });
    await settle();

    expect(result.current.loading).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/(api)/rides", { headers: {} });
  });

  it("R40: a url that becomes null mid-flight (sign-out) stops loading and drops the response", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useFetch<string[], Body>(url),
      { initialProps: { url: "/(api)/rides" as string | null } },
    );
    await settle();

    rerender({ url: null });
    await answer(0, 200, { data: ["previous rider's ride"] });

    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: false,
      error: null,
    });
  });

  it("R40: a url that becomes null forgets the data loaded for the previous one", async () => {
    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useFetch<string[], Body>(url),
      { initialProps: { url: "/(api)/rides" as string | null } },
    );
    await settle();
    await answer(0, 200, { data: ["previous rider's ride"] });

    rerender({ url: null });

    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: false,
      error: null,
    });
  });

  it("R40: a response after unmount is ignored, with no warning", async () => {
    const consoleError = jest.spyOn(console, "error");
    const { result, unmount } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides"),
    );
    await settle();

    unmount();
    await answer(0, 200, { data: ["late"] });

    expect(consoleError).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useFetch — timeoutMs covers the session token too (H10, S2)", () => {
  /**
   * Offline, @clerk/clerk-js 6's getToken retries for about 2.7 minutes
   * before it fails; within a test, it simply never answers.
   */
  const tokenNeverComes = () =>
    auth.getToken.mockImplementation(() => new Promise<string>(() => {}));

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("H10 S2: a session token with no answer counts towards timeoutMs: the load then fails with 'No answer from the server…', and nothing is sent", async () => {
    tokenNeverComes();
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides", {
        authenticated: true,
        timeoutMs: 10_000,
      }),
    );

    await act(() => jest.advanceTimersByTimeAsync(9_999));
    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: true,
      error: null,
    });
    await act(() => jest.advanceTimersByTimeAsync(1));

    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: false,
      error: TIMEOUT_MESSAGE,
    });
    expect(auth.getToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("H10 S2: a token that comes in time leaves the rest of timeoutMs to the request, which is sent with it", async () => {
    let token!: (value: string) => void;
    auth.getToken.mockImplementation(
      () => new Promise<string>((resolve) => (token = resolve)),
    );
    const { result } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides", {
        authenticated: true,
        timeoutMs: 10_000,
      }),
    );

    await act(() => jest.advanceTimersByTimeAsync(4_000));
    await act(async () => token("token-1"));
    expect(fetchMock.mock.calls).toEqual([
      [
        "/(api)/rides",
        {
          headers: { Authorization: "Bearer token-1" },
          signal: expect.any(AbortSignal),
        },
      ],
    ]);
    await act(() => jest.advanceTimersByTimeAsync(5_999));
    expect(result.current.loading).toBe(true);
    await act(() => jest.advanceTimersByTimeAsync(1));

    expect(state(result)).toEqual({
      data: null,
      body: null,
      loading: false,
      error: TIMEOUT_MESSAGE,
    });
    expect(requests[0].init.signal!.aborted).toBe(true);
  });
});

describe("useFetch — one load per url, whatever useAuth returns (EG9)", () => {
  /**
   * @clerk/expo's useAuth wraps getToken in a new function on every render
   * (dist/hooks/useAuth.js), unlike the shared mock's single `auth.getToken`.
   * Each render's getToken here reads its own token, so a stale one shows.
   */
  let renders: number;
  beforeEach(() => {
    renders = 0;
    jest.spyOn(clerk, "useAuth").mockImplementation(() => {
      const render = ++renders;
      return { ...auth, getToken: jest.fn(async () => `token-${render}`) };
    });
  });

  it.each([
    ["/(api)/driver", false],
    ["/(api)/rides", true],
  ])(
    "EG9: %s (authenticated: %s) is loaded once, not again after every answer and every render",
    async (url, authenticated) => {
      const { result, rerender } = renderHook(() =>
        useFetch<string[], Body>(url, { authenticated }),
      );
      await settle();
      await answer(0, 200, { data: ["a"] });
      rerender({});
      await settle();

      expect(renders).toBeGreaterThan(2);
      expect(fetchMock.mock.calls).toEqual([
        [
          url,
          { headers: authenticated ? { Authorization: "Bearer token-1" } : {} },
        ],
      ]);
      expect(state(result)).toEqual({
        data: ["a"],
        body: { data: ["a"] },
        loading: false,
        error: null,
      });
    },
  );

  it("EG9: refetch keeps its identity across renders, and sends the latest render's session token", async () => {
    const { result, rerender } = renderHook(() =>
      useFetch<string[], Body>("/(api)/rides", { authenticated: true }),
    );
    await settle();
    await answer(0, 200, { data: ["first"] });
    const refetch = result.current.refetch;
    rerender({});
    await settle();
    expect(result.current.refetch).toBe(refetch);
    const latest = renders; // the last render before the refetch
    expect(latest).toBeGreaterThan(1);

    await act(() => {
      result.current.refetch();
    });
    await settle();

    expect(fetchMock.mock.calls).toEqual([
      ["/(api)/rides", { headers: { Authorization: "Bearer token-1" } }],
      [
        "/(api)/rides",
        { headers: { Authorization: `Bearer token-${latest}` } },
      ],
    ]);
  });
});
