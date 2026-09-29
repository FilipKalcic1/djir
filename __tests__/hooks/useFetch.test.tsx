import { act, renderHook } from "@testing-library/react-native";

import { useFetch } from "@/hooks/useFetch";

import { settle } from "../helpers/async";
import { fetchResponse } from "../helpers/fetch";
import { auth, resetClerk } from "../helpers/mocks/clerk";

jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"));

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
