/**
 * services/payment — the Payment Sheet's confirmHandler (P3b, P4, P6, P8, P9,
 * K6, R09). `book` and `requote` are the handler's injected I/O; errors are
 * real ApiErrors.
 */
import { ApiError } from "@/services/api";
import { BookingResponse } from "@/services/booking";
import {
  androidRetryHint,
  androidTryAgainHint,
  ConfirmHandlerDeps,
  makeConfirmHandler,
  SLOT_UNAVAILABLE_MESSAGE,
  UNKNOWN_OUTCOME_MESSAGE,
} from "@/services/payment";
import { TripQuote } from "@/types/type";

const NOW = Date.parse("2026-10-03T19:00:00.000Z");
const QUOTE: TripQuote = {
  token: "qt_first",
  fareCents: 974,
  tripMinutes: 12,
  surgeMultiplier: 1,
  source: "ml",
  scheduledAt: null,
  issuedAtMs: NOW,
};
const freshQuote = (fareCents: number): TripQuote => ({
  ...QUOTE,
  token: "qt_fresh",
  fareCents,
  issuedAtMs: NOW + 10 * 60_000,
});
const booked = (rideId: number): BookingResponse => ({
  ride_id: rideId,
  client_secret: `pi_${rideId}_secret_x`,
  status: "succeeded",
});
/** The error a route answers with: `{ error, …extra }`, as fetchAPI wraps it. */
const apiError = (
  status: number,
  error: string,
  code?: string,
  extra: Record<string, unknown> = {},
) => new ApiError(error, status, code ? { error, code, ...extra } : { error });
/** How the handler ends a server message: as a sentence. */
const sentenceOf = (message: string) =>
  /[.!?]$/.test(message) ? message : `${message}.`;
const sheetError = (message: string) => ({
  error: { code: "Failed", message, localizedMessage: message },
});

const DECLINED = "Your card was declined.";
const REJECTED = "The payment could not be processed. Please try another card.";
const NOT_STARTED =
  "We couldn't start the payment, and nothing was charged. Please try again.";
const NOT_TAKEN =
  "The payment didn't go through, and nothing was charged. Please try again.";
const DRIVER_GONE = "That driver is no longer available";
const EXPIRED = "Price expired — refreshing";
const PAYMENT_UNKNOWN =
  "We couldn't confirm whether your payment went through. Check Rides before booking again.";
const LOCKED =
  "We couldn't confirm your payment. Close this sheet and check Rides before booking again.";
const PRICE_UPDATED =
  "Price updated: €9.74 → €10.20. Close this sheet and confirm again.";
const SLOT_GONE = "That pickup time is no longer available";
const ANDROID_RETRY_HINT = androidRetryHint("Confirm Ride");
const ANDROID_TRY_AGAIN_HINT = androidTryAgainHint("Confirm Ride");

type Platform = "ios" | "android";

function setUp(platform: Platform, buttonLabel = "Confirm Ride") {
  const deps = {
    platform,
    quote: QUOTE,
    buttonLabel,
    book: jest.fn<Promise<BookingResponse>, [string, string]>(),
    requote: jest.fn<Promise<TripQuote>, []>(),
    onBooked: jest.fn<void, [number]>(),
    onOutcomeUnknown: jest.fn<void, [number | null]>(),
    onPriceChanged: jest.fn<void, []>(),
    onSlotExpired: jest.fn<void, []>(),
  } satisfies ConfirmHandlerDeps;
  const handler = makeConfirmHandler(deps);
  /** One tap on Pay inside the sheet; returns the intentCreationCallback it was given. */
  const confirm = async (paymentMethodId = "pm_1") => {
    const callback = jest.fn();
    await expect(
      handler({ id: paymentMethodId }, false, callback),
    ).resolves.toBeUndefined();
    return callback;
  };
  return { deps, confirm };
}

const PLATFORMS: Platform[] = ["ios", "android"];

describe("success", () => {
  it.each(PLATFORMS)(
    "P6: books with the quote's token and the card, reports the ride, then hands the sheet its client secret (%s)",
    async (platform) => {
      const { deps, confirm } = setUp(platform);
      deps.book.mockResolvedValueOnce(booked(7));

      const callback = await confirm("pm_visa");

      expect(deps.book.mock.calls).toEqual([["qt_first", "pm_visa"]]);
      expect(deps.onBooked.mock.calls).toEqual([[7]]);
      expect(callback.mock.calls).toEqual([
        [{ clientSecret: "pi_7_secret_x" }],
      ]);
      // Payment reads the ride id once the sheet resolves, so it must be set first.
      expect(deps.onBooked.mock.invocationCallOrder[0]).toBeLessThan(
        callback.mock.invocationCallOrder[0],
      );
      expect(deps.requote).not.toHaveBeenCalled();
      expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
      expect(deps.onPriceChanged).not.toHaveBeenCalled();
    },
  );
});

describe("R09: every failure answers the sheet exactly once, with localizedMessage", () => {
  type Arrange = (deps: ReturnType<typeof setUp>["deps"]) => void;
  const cases: [string, Arrange, { ios: string; android: string }][] = [
    [
      "402 card declined",
      (d) => d.book.mockRejectedValueOnce(apiError(402, DECLINED)),
      { ios: DECLINED, android: DECLINED + ANDROID_RETRY_HINT },
    ],
    [
      "400 card_rejected (E2)",
      (d) =>
        d.book.mockRejectedValueOnce(apiError(400, REJECTED, "card_rejected")),
      { ios: REJECTED, android: REJECTED + ANDROID_RETRY_HINT },
    ],
    [
      "400 that is not about the card (a driver gone)",
      (d) => d.book.mockRejectedValueOnce(apiError(400, DRIVER_GONE)),
      {
        ios: `${DRIVER_GONE}.`,
        android: `${DRIVER_GONE}.${ANDROID_TRY_AGAIN_HINT}`,
      },
    ],
    [
      "502 not_charged (E4: the payment never started)",
      (d) =>
        d.book.mockRejectedValueOnce(apiError(502, NOT_STARTED, "not_charged")),
      { ios: NOT_STARTED, android: NOT_STARTED + ANDROID_TRY_AGAIN_HINT },
    ],
    [
      "401 session expired",
      (d) =>
        d.book.mockRejectedValueOnce(apiError(401, "Please sign in again.")),
      {
        ios: "Please sign in again.",
        android: `Please sign in again.${ANDROID_TRY_AGAIN_HINT}`,
      },
    ],
    [
      "500 server error",
      (d) =>
        d.book.mockRejectedValueOnce(
          apiError(500, "Something went wrong on our side."),
        ),
      { ios: LOCKED, android: LOCKED },
    ],
    [
      "502 payment_unknown",
      (d) =>
        d.book.mockRejectedValueOnce(
          apiError(502, PAYMENT_UNKNOWN, "payment_unknown"),
        ),
      { ios: LOCKED, android: LOCKED },
    ],
    [
      "network error",
      (d) =>
        d.book.mockRejectedValueOnce(new TypeError("Network request failed")),
      { ios: LOCKED, android: LOCKED },
    ],
    [
      "a thrown non-Error",
      (d) => d.book.mockRejectedValueOnce("boom"),
      { ios: LOCKED, android: LOCKED },
    ],
    [
      "quote expired, then a new fare",
      (d) => {
        d.book.mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"));
        d.requote.mockResolvedValueOnce(freshQuote(1020));
      },
      { ios: PRICE_UPDATED, android: PRICE_UPDATED },
    ],
    [
      "quote expired, then the re-quote fails",
      (d) => {
        d.book.mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"));
        d.requote.mockRejectedValueOnce(
          new Error(
            "Couldn't get prices. Check your connection and try again.",
          ),
        );
      },
      {
        ios: "Couldn't get prices. Check your connection and try again.",
        android: `Couldn't get prices. Check your connection and try again.${ANDROID_TRY_AGAIN_HINT}`,
      },
    ],
    [
      "quote expired, same fare, then the card is declined",
      (d) => {
        d.book
          .mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"))
          .mockRejectedValueOnce(apiError(402, DECLINED));
        d.requote.mockResolvedValueOnce(freshQuote(974));
      },
      { ios: DECLINED, android: DECLINED + ANDROID_RETRY_HINT },
    ],
  ];

  describe.each(PLATFORMS)("%s", (platform) => {
    it.each(cases)("R09: %s", async (_label, arrange, messages) => {
      const { deps, confirm } = setUp(platform);
      arrange(deps);

      const callback = await confirm();

      expect(callback.mock.calls).toEqual([[sheetError(messages[platform])]]);
      expect(deps.onBooked).not.toHaveBeenCalled();
    });
  });
});

describe("P3b: the quote expired while the sheet was open", () => {
  it.each(PLATFORMS)(
    "P3b: the same fare books again with the NEW token and succeeds (%s)",
    async (platform) => {
      const { deps, confirm } = setUp(platform);
      deps.book
        .mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"))
        .mockResolvedValueOnce(booked(8));
      deps.requote.mockResolvedValueOnce(freshQuote(974));

      const callback = await confirm("pm_visa");

      expect(deps.requote).toHaveBeenCalledTimes(1);
      expect(deps.book.mock.calls).toEqual([
        ["qt_first", "pm_visa"],
        ["qt_fresh", "pm_visa"],
      ]);
      expect(deps.onBooked.mock.calls).toEqual([[8]]);
      expect(callback.mock.calls).toEqual([
        [{ clientSecret: "pi_8_secret_x" }],
      ]);
      expect(deps.onPriceChanged).not.toHaveBeenCalled();
    },
  );

  it.each(PLATFORMS)(
    "P3b: a different fare fails with 'Price updated…', asks for a new quote and books nothing (%s)",
    async (platform) => {
      const { deps, confirm } = setUp(platform);
      deps.book.mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"));
      deps.requote.mockResolvedValueOnce(freshQuote(1020));

      const callback = await confirm();

      expect(callback.mock.calls).toEqual([[sheetError(PRICE_UPDATED)]]);
      expect(deps.onPriceChanged).toHaveBeenCalledTimes(1);
      expect(deps.book).toHaveBeenCalledTimes(1);
      // Nothing was charged: this is not an unknown outcome (P8).
      expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
    },
  );

  it("P3b: a failed re-quote is not an unknown outcome — nothing was charged, and iOS may retry", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book
      .mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"))
      .mockResolvedValueOnce(booked(9));
    deps.requote.mockRejectedValueOnce(new TypeError("Network request failed"));

    const first = await confirm();
    const second = await confirm();

    // The message becomes a sentence, so nothing reads as run-on text.
    expect(first.mock.calls).toEqual([[sheetError("Network request failed.")]]);
    expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[{ clientSecret: "pi_9_secret_x" }]]);
  });

  it("P3b: a re-quote that fails with a 400 is not mistaken for a card decline on Android (try again, not another card)", async () => {
    const { deps, confirm } = setUp("android");
    deps.book.mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"));
    deps.requote.mockRejectedValueOnce(
      apiError(400, "Trips over 60 km are outside the service area."),
    );

    const callback = await confirm();

    expect(callback.mock.calls).toEqual([
      [
        sheetError(
          `Trips over 60 km are outside the service area.${ANDROID_TRY_AGAIN_HINT}`,
        ),
      ],
    ]);
  });

  it("P3b: re-quotes at most once per confirm", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book.mockRejectedValue(apiError(409, EXPIRED, "quote_expired"));
    deps.requote.mockResolvedValue(freshQuote(974));

    const callback = await confirm();

    expect(deps.requote).toHaveBeenCalledTimes(1);
    expect(deps.book).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls).toEqual([[sheetError(`${EXPIRED}.`)]]);
    expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
  });

  it("P3b iOS: after 'Price updated…' the sheet is not locked — the next tap tries again", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book
      .mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"))
      .mockResolvedValueOnce(booked(10));
    deps.requote.mockResolvedValueOnce(freshQuote(1020));

    await confirm();
    const second = await confirm("pm_2");

    expect(deps.book.mock.calls[1]).toEqual(["qt_first", "pm_2"]);
    expect(second.mock.calls).toEqual([[{ clientSecret: "pi_10_secret_x" }]]);
  });
});

describe("P4: a declined card", () => {
  it("P4 Android: the decline tells the rider to reopen the sheet; every later call is ignored with no network and no callback", async () => {
    const { deps, confirm } = setUp("android");
    deps.book.mockRejectedValueOnce(apiError(402, DECLINED));

    const first = await confirm("pm_declined");
    const second = await confirm("pm_visa");
    const third = await confirm("pm_visa");

    expect(first.mock.calls).toEqual([
      [
        sheetError(
          "Your card was declined. Close this sheet and tap Confirm Ride to try another card.",
        ),
      ],
    ]);
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
    expect(deps.book).toHaveBeenCalledTimes(1);
    expect(deps.requote).not.toHaveBeenCalled();
  });

  it("P4 Android: the hints name the button on screen — 'Schedule Ride' for a scheduled ride", async () => {
    const declined = setUp("android", "Schedule Ride");
    declined.deps.book.mockRejectedValueOnce(apiError(402, DECLINED));
    const signedOut = setUp("android", "Schedule Ride");
    signedOut.deps.book.mockRejectedValueOnce(
      apiError(401, "Please sign in again."),
    );

    const first = await declined.confirm();
    const second = await signedOut.confirm();

    expect(first.mock.calls).toEqual([
      [
        sheetError(
          "Your card was declined. Close this sheet and tap Schedule Ride to try another card.",
        ),
      ],
    ]);
    expect(second.mock.calls).toEqual([
      [
        sheetError(
          "Please sign in again. Close this sheet and tap Schedule Ride to try again.",
        ),
      ],
    ]);
  });

  it.each([
    ["a quote the server refused", apiError(400, "Invalid price quote")],
    ["a driver gone", apiError(400, DRIVER_GONE)],
    ["a field it rejected", apiError(400, "driver_id must be an integer")],
  ])(
    "P4 Android: a 400 that is not about the card (%s) says try again, not another card",
    async (_label, error) => {
      const { deps, confirm } = setUp("android");
      deps.book.mockRejectedValueOnce(error);

      const callback = await confirm();

      expect(callback.mock.calls).toEqual([
        [sheetError(`${sentenceOf(error.message)}${ANDROID_TRY_AGAIN_HINT}`)],
      ]);
    },
  );

  it("P4 Android: a 400 card_rejected (E2) is a decline: another card", async () => {
    const { deps, confirm } = setUp("android");
    deps.book.mockRejectedValueOnce(apiError(400, REJECTED, "card_rejected"));

    const callback = await confirm();

    expect(callback.mock.calls).toEqual([
      [
        sheetError(
          "The payment could not be processed. Please try another card. Close this sheet and tap Confirm Ride to try another card.",
        ),
      ],
    ]);
  });

  it("P4 Android: a later call is ignored after a success too — the first answer stands", async () => {
    const { deps, confirm } = setUp("android");
    deps.book.mockResolvedValueOnce(booked(7));

    await confirm();
    const second = await confirm();

    expect(second).not.toHaveBeenCalled();
    expect(deps.book).toHaveBeenCalledTimes(1);
    expect(deps.onBooked).toHaveBeenCalledTimes(1);
  });

  it("P4 iOS: the decline has no reopen hint, and paying again in the same sheet books again", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book
      .mockRejectedValueOnce(apiError(402, DECLINED))
      .mockResolvedValueOnce(booked(11));

    const first = await confirm("pm_declined");
    const second = await confirm("pm_visa");

    expect(first.mock.calls).toEqual([[sheetError(DECLINED)]]);
    expect(deps.book.mock.calls).toEqual([
      ["qt_first", "pm_declined"],
      ["qt_first", "pm_visa"],
    ]);
    expect(deps.onBooked.mock.calls).toEqual([[11]]);
    expect(second.mock.calls).toEqual([[{ clientSecret: "pi_11_secret_x" }]]);
  });
});

describe("P8: an unknown outcome locks the sheet", () => {
  const unknownOutcomes: [string, unknown][] = [
    ["a network error", new TypeError("Network request failed")],
    ["a 5xx", apiError(503, "Service unavailable.")],
    ["502 payment_unknown", apiError(502, PAYMENT_UNKNOWN, "payment_unknown")],
  ];

  it("P8: one fixed message, whatever the cause (no raw error text, no repeated advice)", () => {
    expect(UNKNOWN_OUTCOME_MESSAGE).toBe(LOCKED);
  });

  it.each(unknownOutcomes)(
    "P8 iOS: %s → onOutcomeUnknown, the check-Rides message, and no second charge attempt",
    async (_label, error) => {
      const { deps, confirm } = setUp("ios");
      deps.book.mockRejectedValueOnce(error);

      const first = await confirm();
      const second = await confirm("pm_other");
      const third = await confirm("pm_other");

      expect(first.mock.calls).toEqual([[sheetError(LOCKED)]]);
      expect(deps.onOutcomeUnknown).toHaveBeenCalledTimes(1);
      expect(second.mock.calls).toEqual([[sheetError(LOCKED)]]);
      expect(third.mock.calls).toEqual([[sheetError(LOCKED)]]);
      expect(deps.book).toHaveBeenCalledTimes(1);
      expect(deps.onBooked).not.toHaveBeenCalled();
    },
  );

  it.each(unknownOutcomes)(
    "P8 Android: %s → onOutcomeUnknown and the check-Rides message (never the card hint); later calls are ignored",
    async (_label, error) => {
      const { deps, confirm } = setUp("android");
      deps.book.mockRejectedValueOnce(error);

      const first = await confirm();
      const second = await confirm();

      expect(first.mock.calls).toEqual([[sheetError(LOCKED)]]);
      expect(deps.onOutcomeUnknown).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
      expect(deps.book).toHaveBeenCalledTimes(1);
    },
  );

  it("P8: an unknown outcome on the re-booked fresh quote locks the sheet too", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book
      .mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"))
      .mockRejectedValueOnce(new TypeError("Network request failed"));
    deps.requote.mockResolvedValueOnce(freshQuote(974));

    const first = await confirm();
    const second = await confirm();

    expect(first.mock.calls).toEqual([[sheetError(LOCKED)]]);
    expect(deps.onOutcomeUnknown).toHaveBeenCalledTimes(1);
    expect(second.mock.calls).toEqual([[sheetError(LOCKED)]]);
    expect(deps.book).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["E4: the payment never started", NOT_STARTED],
    ["E3: Stripe says it was never taken", NOT_TAKEN],
  ])(
    "P8 %s (502 not_charged) is a known outcome: the server's message, no lock, and the next tap pays (iOS)",
    async (_label, message) => {
      const { deps, confirm } = setUp("ios");
      deps.book
        .mockRejectedValueOnce(apiError(502, message, "not_charged"))
        .mockResolvedValueOnce(booked(13));

      const first = await confirm();
      const second = await confirm();

      expect(first.mock.calls).toEqual([[sheetError(message)]]);
      expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
      expect(second.mock.calls).toEqual([[{ clientSecret: "pi_13_secret_x" }]]);
    },
  );

  it("P8 P4 Android: a 502 not_charged says to reopen the sheet and try again — never 'check Rides', never 'another card'", async () => {
    const { deps, confirm } = setUp("android");
    deps.book.mockRejectedValueOnce(apiError(502, NOT_STARTED, "not_charged"));

    const callback = await confirm();

    expect(callback.mock.calls).toEqual([
      [
        sheetError(
          "We couldn't start the payment, and nothing was charged. Please try again. Close this sheet and tap Confirm Ride to try again.",
        ),
      ],
    ]);
    expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
  });

  it("P8: a 4xx that is not a decline does not lock the sheet", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book
      .mockRejectedValueOnce(apiError(401, "Please sign in again."))
      .mockResolvedValueOnce(booked(12));

    await confirm();
    const second = await confirm();

    expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[{ clientSecret: "pi_12_secret_x" }]]);
  });

  it("P8: a payment_unknown that names its ride hands that ride id to onOutcomeUnknown", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book.mockRejectedValueOnce(
      apiError(502, PAYMENT_UNKNOWN, "payment_unknown", { ride_id: 42 }),
    );

    const callback = await confirm();

    expect(deps.onOutcomeUnknown.mock.calls).toEqual([[42]]);
    expect(callback.mock.calls).toEqual([[sheetError(LOCKED)]]);
  });

  it.each([
    ["a network error", new TypeError("Network request failed")],
    [
      "a 5xx without a body",
      new ApiError("Request failed (HTTP 503)", 503, null),
    ],
    [
      "an HTML 502",
      new ApiError("Request failed (HTTP 502)", 502, "<html></html>"),
    ],
    [
      "a payment_unknown without ride_id",
      apiError(502, PAYMENT_UNKNOWN, "payment_unknown"),
    ],
    [
      "a non-integer ride_id",
      apiError(502, PAYMENT_UNKNOWN, "payment_unknown", { ride_id: "42" }),
    ],
  ])(
    "P8: %s gives onOutcomeUnknown(null) — no ride to ask about",
    async (_label, error) => {
      const { deps, confirm } = setUp("ios");
      deps.book.mockRejectedValueOnce(error);

      await confirm();

      expect(deps.onOutcomeUnknown.mock.calls).toEqual([[null]]);
    },
  );
});

describe("P9: a booking that succeeded is never made twice", () => {
  it.each(PLATFORMS)(
    "P9: after a successful booking, later calls in the same sheet never book again (%s)",
    async (platform) => {
      const { deps, confirm } = setUp(platform);
      deps.book.mockResolvedValue(booked(7));

      const first = await confirm("pm_visa");
      const second = await confirm("pm_other");
      const third = await confirm("pm_other");

      expect(first.mock.calls).toEqual([[{ clientSecret: "pi_7_secret_x" }]]);
      // iOS gets the same PaymentIntent again; Android keeps its first answer (P4).
      const later =
        platform === "ios" ? [[{ clientSecret: "pi_7_secret_x" }]] : [];
      expect(second.mock.calls).toEqual(later);
      expect(third.mock.calls).toEqual(later);
      expect(deps.book).toHaveBeenCalledTimes(1);
      expect(deps.onBooked.mock.calls).toEqual([[7]]);
    },
  );

  it("P9: a booking made with a re-quoted token is remembered too", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book
      .mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"))
      .mockResolvedValueOnce(booked(8));
    deps.requote.mockResolvedValueOnce(freshQuote(974));

    await confirm();
    const second = await confirm();

    expect(second.mock.calls).toEqual([[{ clientSecret: "pi_8_secret_x" }]]);
    expect(deps.book).toHaveBeenCalledTimes(2);
    expect(deps.requote).toHaveBeenCalledTimes(1);
  });
});

describe("K6: the pickup slot is no longer bookable", () => {
  it.each(PLATFORMS)(
    "K6: a 409 slot_unavailable says so with no retry hint, and reports the expired slot (%s)",
    async (platform) => {
      const { deps, confirm } = setUp(platform, "Schedule Ride");
      deps.book.mockRejectedValueOnce(
        apiError(409, SLOT_GONE, "slot_unavailable"),
      );

      const callback = await confirm();

      expect(SLOT_UNAVAILABLE_MESSAGE).toBe(
        "That pickup time is no longer available. Close this sheet to choose a new time.",
      );
      expect(callback.mock.calls).toEqual([
        [sheetError(SLOT_UNAVAILABLE_MESSAGE)],
      ]);
      expect(deps.onSlotExpired).toHaveBeenCalledTimes(1);
      expect(deps.onOutcomeUnknown).not.toHaveBeenCalled();
      expect(deps.onBooked).not.toHaveBeenCalled();
    },
  );

  it.each(PLATFORMS)(
    "K6: a P3b re-quote answered 400 slot_unavailable is the same expired slot (%s)",
    async (platform) => {
      const { deps, confirm } = setUp(platform, "Schedule Ride");
      deps.book.mockRejectedValueOnce(apiError(409, EXPIRED, "quote_expired"));
      deps.requote.mockRejectedValueOnce(
        apiError(400, SLOT_GONE, "slot_unavailable"),
      );

      const callback = await confirm();

      expect(callback.mock.calls).toEqual([
        [sheetError(SLOT_UNAVAILABLE_MESSAGE)],
      ]);
      expect(deps.onSlotExpired).toHaveBeenCalledTimes(1);
      expect(deps.book).toHaveBeenCalledTimes(1);
    },
  );

  it("K6: other failures leave the slot alone", async () => {
    const { deps, confirm } = setUp("ios");
    deps.book.mockRejectedValueOnce(apiError(402, DECLINED));

    await confirm();

    expect(deps.onSlotExpired).not.toHaveBeenCalled();
  });
});
