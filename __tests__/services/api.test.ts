/**
 * services/api — the one fetch wrapper every app request goes through (R07).
 * Only `fetch` is faked; responses are real `Response` objects.
 */
import {
  ApiError,
  apiErrorCode,
  fetchAPI,
  TIMEOUT_MESSAGE,
  TOKEN_TIMEOUT_MS,
} from "@/services/api";

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

const reply = (
  status: number,
  body: string,
  contentType = "application/json",
) =>
  fetchMock.mockResolvedValueOnce(
    new Response(body, { status, headers: { "Content-Type": contentType } }),
  );
const sentInit = () => fetchMock.mock.calls[0][1];

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected fetchAPI to reject");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeEach(() => {
  fetchMock.mockReset();
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((url, init) => fetchMock(url as string, init!));
});
afterEach(() => jest.restoreAllMocks());

describe("fetchAPI — request", () => {
  it("R07: sends the app-relative URL as given (Expo Router resolves it against the configured origin)", async () => {
    reply(200, "{}");
    await fetchAPI("/(api)/rides");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/(api)/rides");
  });

  it("R07: sends 'Authorization: Bearer <token>' when a token is given", async () => {
    reply(200, "{}");
    await fetchAPI("/(api)/rides", { token: "jwt_abc" });
    expect(sentInit().headers).toEqual({ Authorization: "Bearer jwt_abc" });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
  ])(
    "R07: sends no Authorization header when the token is %s",
    async (_label, token) => {
      reply(200, "{}");
      await fetchAPI("/(api)/driver", { token });
      expect(sentInit().headers).toEqual({});
    },
  );

  it("R07: a JSON body is sent with its method and 'Content-Type: application/json'; the token option is not forwarded", async () => {
    reply(200, "{}");
    const body = JSON.stringify({ ride_id: 7 });
    await fetchAPI("/(api)/ride/confirm", {
      method: "POST",
      token: "jwt_abc",
      body,
    });
    expect(sentInit()).toEqual({
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer jwt_abc",
      },
    });
  });

  it("R07: forwards other init fields and lets caller headers override the defaults", async () => {
    reply(200, "{}");
    const controller = new AbortController();
    await fetchAPI("/(api)/ride/book", {
      method: "POST",
      body: "x=1",
      signal: controller.signal,
      headers: { "Content-Type": "text/plain", "X-Trace": "t1" },
    });
    expect(sentInit()).toEqual({
      method: "POST",
      body: "x=1",
      signal: controller.signal,
      headers: { "Content-Type": "text/plain", "X-Trace": "t1" },
    });
  });
});

describe("fetchAPI — response", () => {
  it("R07: resolves with the parsed JSON body of a 2xx response", async () => {
    reply(200, JSON.stringify({ data: [{ ride_id: 1 }] }));
    await expect(fetchAPI("/(api)/rides")).resolves.toEqual({
      data: [{ ride_id: 1 }],
    });
  });

  it("R07: resolves with null for an empty 2xx body", async () => {
    reply(200, "");
    await expect(fetchAPI("/(api)/rides")).resolves.toBeNull();
  });

  it("R07: a non-2xx throws ApiError carrying the server's { error } message, the status and the body", async () => {
    const body = { error: "Price expired — refreshing", code: "quote_expired" };
    reply(409, JSON.stringify(body));
    const error = await rejection(fetchAPI("/(api)/ride/book"));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("Price expired — refreshing");
    expect(error.status).toBe(409);
    expect(error.body).toEqual(body);
  });

  it("R07: an HTML error page (e.g. a proxy's 502) gives 'Request failed (HTTP 502)' and keeps the raw text as the body", async () => {
    const html = "<html><body><h1>502 Bad Gateway</h1></body></html>";
    reply(502, html, "text/html");
    const error = await rejection(fetchAPI("/(api)/rides"));
    expect(error.message).toBe("Request failed (HTTP 502)");
    expect(error.status).toBe(502);
    expect(error.body).toBe(html);
  });

  it("R07: an empty error body gives 'Request failed (HTTP 500)' with a null body", async () => {
    reply(500, "");
    const error = await rejection(fetchAPI("/(api)/rides"));
    expect(error.message).toBe("Request failed (HTTP 500)");
    expect(error.body).toBeNull();
  });

  it("R07: a JSON error whose `error` is not a string falls back to the status message", async () => {
    reply(400, JSON.stringify({ error: { field: "ride_id" } }));
    const error = await rejection(fetchAPI("/(api)/ride/cancel"));
    expect(error.message).toBe("Request failed (HTTP 400)");
    expect(error.body).toEqual({ error: { field: "ride_id" } });
  });

  it("R07: a network failure propagates unchanged (it is not an ApiError)", async () => {
    const offline = new TypeError("Network request failed");
    fetchMock.mockRejectedValueOnce(offline);
    await expect(fetchAPI("/(api)/rides")).rejects.toBe(offline);
  });
});

describe("fetchAPI — timeoutMs (a load that never answers)", () => {
  /**
   * A request that ends only when its signal aborts it, as a real fetch does
   * (which also refuses a signal that is already aborted).
   */
  const hangs = () =>
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) => {
          const aborted = () =>
            reject(new DOMException("Aborted", "AbortError"));
          if (init.signal!.aborted) aborted();
          init.signal!.addEventListener("abort", aborted);
        }),
    );

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("Q5 H10: with no answer after timeoutMs the request is aborted and fails with 'No answer from the server…'", async () => {
    hangs();
    const request = fetchAPI("/(api)/driver", { timeoutMs: 10_000 });
    const outcome = request.catch((error: Error) => error);

    await jest.advanceTimersByTimeAsync(9_999);
    expect(sentInit().signal!.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const error = await outcome;
    expect(error).toEqual(new Error(TIMEOUT_MESSAGE));
    expect(error).not.toBeInstanceOf(ApiError);
    expect(TIMEOUT_MESSAGE).toBe(
      "No answer from the server. Check your connection and try again.",
    );
    expect(sentInit().signal!.aborted).toBe(true);
  });

  it("Q5 H10: an answer in time resolves as usual, sends the same headers, and leaves no timer behind", async () => {
    reply(200, JSON.stringify({ data: [1] }));

    await expect(
      fetchAPI("/(api)/rides", { token: "jwt_abc", timeoutMs: 10_000 }),
    ).resolves.toEqual({ data: [1] });

    expect(sentInit().headers).toEqual({ Authorization: "Bearer jwt_abc" });
    expect(sentInit().signal).toBeInstanceOf(AbortSignal);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("Q5 H10: a server error in time is still the server's ApiError, not a timeout", async () => {
    reply(503, JSON.stringify({ error: "Database unavailable" }));

    const error = await rejection(
      fetchAPI("/(api)/rides", { timeoutMs: 10_000 }),
    );

    expect(error.message).toBe("Database unavailable");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("Q5 H10: the caller's own signal still aborts it, with the abort error rather than the timeout message", async () => {
    hangs();
    const caller = new AbortController();
    const outcome = fetchAPI("/(api)/driver", {
      signal: caller.signal,
      timeoutMs: 10_000,
    }).catch((error: Error) => error);

    caller.abort();

    expect((await outcome).name).toBe("AbortError");
    expect(sentInit().signal!.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("Q5 H10: a caller's signal that was aborted before the call aborts the request at once", async () => {
    hangs();
    const caller = new AbortController();
    caller.abort();

    const error = await fetchAPI("/(api)/driver", {
      signal: caller.signal,
      timeoutMs: 10_000,
    }).catch((e: Error) => e);

    expect(error.name).toBe("AbortError");
  });
});

describe("fetchAPI — getToken, Clerk's session token read as the request starts", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([
    ["a token", "jwt_abc", { Authorization: "Bearer jwt_abc" }],
    ["null (signed out)", null, {}],
  ])(
    "R07: getToken reading %s sends the same headers as that token would",
    async (_, token, headers) => {
      reply(200, "{}");
      const getToken = jest.fn(async () => token);

      await fetchAPI("/(api)/rides", { getToken });

      expect(getToken).toHaveBeenCalledTimes(1);
      expect(sentInit()).toEqual({ headers });
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("R07: a getToken that fails fails the request with its error, and nothing is sent", async () => {
    const expired = new Error("Session expired");

    await expect(
      fetchAPI("/(api)/ride/cancel", {
        method: "POST",
        getToken: async () => {
          throw expired;
        },
      }),
    ).rejects.toBe(expired);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("R07: without timeoutMs, a getToken with no answer still fails the request after TOKEN_TIMEOUT_MS with 'No answer from the server…', and nothing is sent", async () => {
    // Offline, @clerk/clerk-js 6 retries a session token for about 2.7
    // minutes before it gives up; within a test it never answers at all.
    let outcome: unknown = "pending";
    fetchAPI("/(api)/ride/book", {
      method: "POST",
      body: "{}",
      getToken: () => new Promise<string>(() => {}),
    }).catch((error: unknown) => (outcome = error));

    await jest.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS - 1);
    expect(outcome).toBe("pending");
    await jest.advanceTimersByTimeAsync(1);

    expect(outcome).toEqual(new Error(TIMEOUT_MESSAGE));
    expect(TOKEN_TIMEOUT_MS).toBe(10_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("apiErrorCode — the route's machine-readable code", () => {
  it("R07: reads the `code` a route sends with its error", () => {
    const error = new ApiError("That pickup time is no longer available", 409, {
      error: "That pickup time is no longer available",
      code: "slot_unavailable",
    });

    expect(apiErrorCode(error)).toBe("slot_unavailable");
  });

  it.each([
    [
      "an ApiError without a code",
      new ApiError("Nope", 400, { error: "Nope" }),
    ],
    [
      "an ApiError with a non-string code",
      new ApiError("Nope", 400, { code: 7 }),
    ],
    [
      "an ApiError with a null body",
      new ApiError("Request failed (HTTP 500)", 500, null),
    ],
    [
      "an ApiError with an HTML body",
      new ApiError("Request failed (HTTP 502)", 502, "<html></html>"),
    ],
    ["a network error", new TypeError("Network request failed")],
    ["a thrown string", "boom"],
  ])("R07: is null for %s", (_label, error) => {
    expect(apiErrorCode(error)).toBeNull();
  });
});
