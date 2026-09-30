/**
 * services/booking — the booking API as the app calls it. Only `fetch` and
 * Clerk's getToken are faked; fetchAPI is real.
 */

import { ApiError, TIMEOUT_MESSAGE, TOKEN_TIMEOUT_MS } from "@/services/api";
import {
  bookRide,
  BookingRequest,
  cancelRide,
  confirmRide,
  GetToken,
  sheetError,
} from "@/services/booking";

import { makeRide } from "../helpers/rides";

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });
const offline = () => new TypeError("Network request failed");

/** Each call hands out the next token, as Clerk does when a session refreshes. */
const tokens = (...values: string[]) => {
  const getToken = jest.fn<Promise<string | null>, []>();
  values.forEach((value) => getToken.mockResolvedValueOnce(value));
  return getToken;
};
const sent = (call: number) => {
  const [url, init] = fetchMock.mock.calls[call];
  return {
    url,
    method: init.method,
    authorization: (init.headers as Record<string, string>).Authorization,
    body: JSON.parse(init.body as string),
  };
};

const request: BookingRequest = {
  quoteToken: "qt_signed",
  driverId: 3,
  paymentMethodId: "pm_card_visa",
  originAddress: "Tresnjevka, Zagreb",
  destinationAddress: "Trg bana Jelačića, Zagreb",
};

beforeEach(() => {
  fetchMock.mockReset();
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((url, init) => fetchMock(url as string, init!));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("bookRide", () => {
  it("POSTs the quote token, driver, payment method and addresses — and no money fields", async () => {
    const reply = {
      ride_id: 7,
      client_secret: "pi_7_secret",
      status: "succeeded",
    };
    fetchMock.mockResolvedValueOnce(json(200, reply));

    const result = await bookRide(request, tokens("jwt_1"));

    expect(result).toEqual(reply);
    expect(sent(0)).toEqual({
      url: "/(api)/ride/book",
      method: "POST",
      authorization: "Bearer jwt_1",
      body: {
        quote_token: "qt_signed",
        driver_id: 3,
        payment_method_id: "pm_card_visa",
        origin_address: "Tresnjevka, Zagreb",
        destination_address: "Trg bana Jelačića, Zagreb",
      },
    });
  });

  it("asks Clerk for a fresh token on every call", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { ride_id: 1 }))
      .mockResolvedValueOnce(json(200, { ride_id: 2 }));
    const getToken = tokens("jwt_1", "jwt_2");

    await bookRide(request, getToken);
    await bookRide(request, getToken);

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(sent(0).authorization).toBe("Bearer jwt_1");
    expect(sent(1).authorization).toBe("Bearer jwt_2");
  });

  it("rejects with the server's ApiError (a 409 quote_expired keeps its code)", async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, { error: "Price expired — refreshing", code: "quote_expired" }),
    );

    const error = await bookRide(request, tokens("jwt_1")).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "Price expired — refreshing",
      status: 409,
      body: { code: "quote_expired" },
    });
  });
});

describe("confirmRide — 3 idempotent attempts with backoff (P6)", () => {
  const paid = makeRide({ ride_id: 7 });

  it("P6: confirms the ride with a Bearer token and resolves with the ride", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: paid }));

    await expect(confirmRide(7, tokens("jwt_1"))).resolves.toEqual(paid);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0)).toEqual({
      url: "/(api)/ride/confirm",
      method: "POST",
      authorization: "Bearer jwt_1",
      body: { ride_id: 7 },
    });
  });

  it("P6: retries after 800 ms, then 1600 ms, with a fresh token each time, and succeeds on the third attempt", async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce(json(502, { error: "Stripe unavailable" }))
      .mockResolvedValueOnce(json(200, { data: paid }));
    const getToken = tokens("jwt_1", "jwt_2", "jwt_3");

    const result = confirmRide(7, getToken);

    await jest.advanceTimersByTimeAsync(799);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1599);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(result).resolves.toEqual(paid);
    expect([0, 1, 2].map((i) => sent(i).authorization)).toEqual([
      "Bearer jwt_1",
      "Bearer jwt_2",
      "Bearer jwt_3",
    ]);
    expect([0, 1, 2].map((i) => sent(i).body)).toEqual([
      { ride_id: 7 },
      { ride_id: 7 },
      { ride_id: 7 },
    ]);
  });

  it("P6: stops retrying as soon as an attempt succeeds", async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce(json(200, { data: paid }));

    const result = confirmRide(7, tokens("jwt_1", "jwt_2"));
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual(paid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("P7: gives up after the third failure, rejecting with the last error and without a further wait", async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce(json(503, { error: "Try again later" }));

    const result = confirmRide(7, tokens("jwt_1", "jwt_2", "jwt_3")).catch(
      (e) => e,
    );
    await jest.advanceTimersByTimeAsync(2_400);

    const error = await result;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Try again later", status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("honours custom attempts and backoff", async () => {
    jest.useFakeTimers();
    fetchMock.mockRejectedValue(offline());

    const result = confirmRide(
      7,
      jest.fn(async () => "jwt"),
      {
        attempts: 2,
        backoffMs: 100,
      },
    ).catch((e) => e);
    await jest.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(await result).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("cancelRide", () => {
  it("POSTs the ride id with a fresh token and resolves with the cancelled ride", async () => {
    const cancelled = makeRide({
      ride_id: 9,
      payment_status: "refunded",
      cancelled_at: "2026-10-03T18:00:00.000Z",
    });
    fetchMock.mockResolvedValueOnce(json(200, { data: cancelled }));

    await expect(cancelRide(9, tokens("jwt_9"))).resolves.toEqual(cancelled);

    expect(sent(0)).toEqual({
      url: "/(api)/ride/cancel",
      method: "POST",
      authorization: "Bearer jwt_9",
      body: { ride_id: 9 },
    });
  });

  it("a 409 rejects with the server's message and is not retried", async () => {
    const message =
      "Your driver is already on the way — this ride can no longer be cancelled";
    fetchMock.mockResolvedValueOnce(json(409, { error: message }));

    const error = await cancelRide(9, tokens("jwt_9")).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message, status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a session token with no answer (offline, @clerk/clerk-js 6 retries one for about 2.7 minutes)", () => {
  /** A getToken that never answers, as far as a test can tell. */
  const tokenNeverComes = () =>
    jest.fn<Promise<string | null>, []>(() => new Promise(() => {}));
  /** Where a call stands: "pending", or what it resolved or rejected with. */
  const track = (call: Promise<unknown>) => {
    const outcome = { current: "pending" as unknown };
    call.then(
      (value) => (outcome.current = value),
      (error: unknown) => (outcome.current = error),
    );
    return outcome;
  };

  beforeEach(() => jest.useFakeTimers());

  it.each([
    ["P8: bookRide", (getToken: GetToken) => bookRide(request, getToken)],
    ["X9: cancelRide", (getToken: GetToken) => cancelRide(9, getToken)],
  ])(
    "%s gives up after TOKEN_TIMEOUT_MS with 'No answer from the server…', and nothing is sent",
    async (_, call) => {
      const outcome = track(call(tokenNeverComes()));

      await jest.advanceTimersByTimeAsync(TOKEN_TIMEOUT_MS - 1);
      expect(outcome.current).toBe("pending");
      await jest.advanceTimersByTimeAsync(1);

      expect(outcome.current).toEqual(new Error(TIMEOUT_MESSAGE));
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("P7: confirmRide's three attempts each give up on the token after TOKEN_TIMEOUT_MS, so the rider hears within 33 s, not 8 minutes", async () => {
    const getToken = tokenNeverComes();
    const outcome = track(confirmRide(7, getToken));

    // 3 × 10 s for the token, plus the 800 ms and 1600 ms backoffs.
    await jest.advanceTimersByTimeAsync(3 * TOKEN_TIMEOUT_MS + 2_400 - 1);
    expect(outcome.current).toBe("pending");
    await jest.advanceTimersByTimeAsync(1);

    expect(outcome.current).toEqual(new Error(TIMEOUT_MESSAGE));
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("sheetError", () => {
  it("R09: carries the message as both message and localizedMessage (the only field iOS shows)", () => {
    expect(sheetError("Your card was declined.")).toEqual({
      code: "Failed",
      message: "Your card was declined.",
      localizedMessage: "Your card was declined.",
    });
  });
});
