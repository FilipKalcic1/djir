/**
 * The money path, end to end on a real Postgres (PGlite) with real JWTs and
 * quote tokens; only Stripe is faked. Test titles carry the build plan's row
 * IDs (E = errors, PT = payment transitions, M = money invariant, X = cancel)
 * and the review's R-ids.
 */
import { POST as book } from "@/app/(api)/ride/book+api";
import { POST as cancel } from "@/app/(api)/ride/cancel+api";
import { POST as confirm } from "@/app/(api)/ride/confirm+api";
import { GET as rides } from "@/app/(api)/rides+api";
import { driverStartFor } from "@/lib/map";
import { pickupMinutesFor } from "@/lib/pricing";
import { signQuote } from "@/server/quote-token";
import { nextPaymentState } from "@/server/rides";
import { Ride } from "@/types/type";

import {
  asUser,
  get,
  mockDb,
  mockStripe,
  post,
  quoteToken,
  rows,
  setUpApiTest,
  stripeBooks,
  stripeError,
  stripeReports,
  stripeShowsRefunds,
} from "../helpers/api";
import { MIN } from "../helpers/rides";

jest.mock("@/server/db", () => ({ sql: () => mockDb.current!.sql }));
jest.mock("@/server/stripe", () => ({ stripe: () => mockStripe }));

const SLOT = 15 * MIN;
/** The first slot on the 15-minute UTC grid at least `minutes` from now (K2). */
const slotIn = (minutes: number) =>
  Math.ceil((Date.now() + minutes * MIN) / SLOT) * SLOT;
const booking = async (overrides: Record<string, unknown> = {}) => ({
  quote_token: await quoteToken(),
  driver_id: 3,
  payment_method_id: "pm_card_visa",
  origin_address: "Tresnjevka, Zagreb",
  destination_address: "Trg bana Jelačića, Zagreb",
  ...overrides,
});
const REFUNDED = { id: "re_1", status: "succeeded" };
const REFUND_FAILED =
  "The refund didn't go through, so your ride is still booked. Please try again.";
const REFUND_UNKNOWN = {
  error: "We couldn't confirm the refund. Check your ride again in a moment.",
  code: "refund_unknown",
};
const PAYMENT_UNKNOWN = {
  error:
    "We couldn't confirm whether your payment went through. Check Rides before booking again.",
  code: "payment_unknown",
  ride_id: 1,
};
const NOT_CHARGED = {
  error:
    "The payment didn't go through, and nothing was charged. Please try again.",
  code: "not_charged",
};
const SERVER_FAULT = {
  error: "Something went wrong on our side. Please try again later.",
};
const history = async (user = "user_1") =>
  (await get(rides, "/rides", await asUser(user))).body.data as Ride[];
const ageRides = (minutes: number) =>
  rows`UPDATE rides SET created_at = now() - make_interval(secs => ${minutes * 60})`;
const statuses = async () =>
  (await rows`SELECT payment_status FROM rides ORDER BY ride_id`).map(
    (r) => r.payment_status,
  );
/** Ride 1's payment status, whether it is cancelled, and whether a cancel is still open. */
const cancelState = async () =>
  (
    await rows`SELECT payment_status, cancelled_at IS NOT NULL AS cancelled,
      cancel_requested_at IS NOT NULL AS requested FROM rides WHERE ride_id = 1`
  )[0];
/** A pending reservation written straight to the DB, `ageMinutes` old. */
const insertPending = (ageMinutes: number, intentId: string | null = null) =>
  rows`INSERT INTO rides (origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, pickup_minutes, fare_price, payment_status,
    payment_intent_id, driver_id, user_id, created_at)
    VALUES ('A', 'B', 45.8, 15.9, 45.81, 15.97, 10, 5, 9.74, 'pending', ${intentId}, 1, 'user_1',
      now() - make_interval(secs => ${ageMinutes * 60}))`;
const retrievedIds = () =>
  mockStripe.paymentIntents.retrieve.mock.calls.map((call) => call[0]);
/** Fake only the timers a route arms from here on; the DB and Jest keep the real clock. */
const fakeTimersOnly = () =>
  jest.useFakeTimers({
    doNotFake: [
      "Date",
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "setImmediate",
      "clearImmediate",
    ],
  });
/** The text of every SQL statement the routes run from now on. */
function recordSql(): string[] {
  const realSql = mockDb.current!.sql;
  const texts: string[] = [];
  mockDb.current!.sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    texts.push(strings.join("?"));
    return realSql(strings, ...values);
  }) as typeof realSql;
  return texts;
}
/** Make one kind of UPDATE fail once, as if the process died right there. */
function failOnce(fragment: string) {
  const realSql = mockDb.current!.sql;
  let failed = false;
  mockDb.current!.sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    if (!failed && strings.join("?").includes(fragment)) {
      failed = true;
      throw new Error("connection lost");
    }
    return realSql(strings, ...values);
  }) as typeof realSql;
}

beforeEach(async () => {
  await setUpApiTest();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("POST /ride/book", () => {
  it("R01: is a 401 without a session, touching neither the DB nor Stripe", async () => {
    const res = await post(book, "/ride/book", await booking());
    expect(res.status).toBe(401);
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(await rows`SELECT * FROM rides`).toHaveLength(0);
  });

  it("R04 R08: charges the signed fare; money and identity fields in the body are ignored", async () => {
    stripeBooks("succeeded");
    const res = await post(
      book,
      "/ride/book",
      await booking({
        amount: 0.5,
        fare_price: 1,
        user_id: "user_victim",
        payment_status: "paid",
      }),
      await asUser("user_1"),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ride_id: 1,
      client_secret: "pi_1_secret_x",
      status: "succeeded",
    });
    expect(mockStripe.paymentIntents.create.mock.calls[0][0].amount).toBe(974);
    const [ride] =
      await rows`SELECT user_id, fare_price, payment_status, payment_intent_id, paid_at FROM rides`;
    expect(ride).toMatchObject({
      user_id: "user_1",
      fare_price: "9.74",
      payment_status: "paid",
      payment_intent_id: "pi_1",
    });
    expect(Date.now() - ride.paid_at.getTime()).toBeLessThan(5000);
  });

  it.each([
    [
      "tampered",
      async () => {
        const [, sig] = (await quoteToken()).split(".");
        const cheaper = Buffer.from(
          JSON.stringify({ v: 1, fareCents: 50 }),
        ).toString("base64url");
        return `${cheaper}.${sig}`;
      },
      400,
    ],
    [
      "signed with another secret",
      () =>
        signQuote(
          {
            v: 1,
            pickup: [45.8, 15.945],
            dropoff: [45.8085, 15.9775],
            scheduledAt: null,
            fareCents: 50,
            tripMinutes: 12,
            source: "x",
            iat: Date.now(),
          },
          "some-other-secret-that-is-32-chars!!",
        ),
      400,
    ],
    ["expired", () => quoteToken({ iat: Date.now() - 11 * MIN }), 409],
    [
      "issued in the future",
      () => quoteToken({ iat: Date.now() + 60 * MIN }),
      409,
    ],
  ])(
    "R04: a %s quote is refused before any INSERT or Stripe call",
    async (_, makeToken, status) => {
      const res = await post(
        book,
        "/ride/book",
        await booking({ quote_token: await makeToken() }),
        await asUser(),
      );
      expect(res.status).toBe(status);
      expect(await rows`SELECT * FROM rides`).toHaveLength(0);
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    },
  );

  it("R02 R71: creates an unconfirmed card-only PaymentIntent, saves it, then confirms it", async () => {
    stripeBooks("succeeded");
    await post(book, "/ride/book", await booking(), await asUser("user_1"));
    const [createParams, createOptions] =
      mockStripe.paymentIntents.create.mock.calls[0];
    expect(createParams).toEqual({
      amount: 974,
      currency: "eur",
      payment_method_types: ["card"],
      capture_method: "automatic",
      metadata: { ride_id: "1", clerk_user_id: "user_1" },
    });
    // A nonce: ride ids restart after a DB reset, Stripe keeps keys for 24 h.
    expect(createOptions.idempotencyKey).toMatch(/^ride-1-[0-9a-f-]{36}$/);
    expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith("pi_1", {
      payment_method: "pm_card_visa",
      use_stripe_sdk: true,
      return_url: "djir://stripe-redirect",
      expand: ["latest_charge"],
    });
    // No Stripe customers or ephemeral keys exist in this flow at all.
    expect(Object.keys(mockStripe).sort()).toEqual([
      "paymentIntents",
      "refunds",
    ]);
  });

  it("R14: stores the pickup time the rider was shown, and the slot of a scheduled ride", async () => {
    stripeBooks("requires_action");
    const slot = slotIn(2 * 24 * 60);
    await post(
      book,
      "/ride/book",
      await booking({ quote_token: await quoteToken({ scheduledAt: slot }) }),
      await asUser(),
    );
    const [ride] =
      await rows`SELECT pickup_minutes, ride_time, scheduled_at, payment_status FROM rides`;
    const pickup = { latitude: 45.8, longitude: 15.945 };
    expect(ride.pickup_minutes).toBe(
      pickupMinutesFor(driverStartFor(3, pickup), pickup),
    );
    expect(ride.ride_time).toBe(12);
    expect(ride.scheduled_at.getTime()).toBe(slot);
    expect(ride.payment_status).toBe("pending"); // 3-D Secure still to come
  });

  it("K13: refuses a scheduled slot that has passed since it was quoted (409 slot_unavailable)", async () => {
    const token = await quoteToken({ scheduledAt: slotIn(10) }); // < 25 min away
    const res = await post(
      book,
      "/ride/book",
      await booking({ quote_token: token }),
      await asUser(),
    );
    expect(res).toEqual({
      status: 409,
      body: {
        error: "That pickup time is no longer available",
        code: "slot_unavailable",
      },
    });
  });

  it("K2: refuses a slot off the 15-minute grid (409 slot_unavailable) before any INSERT or Stripe call", async () => {
    const offGrid = slotIn(24 * 60) + 7 * MIN + 33_000; // hh:07:33
    const res = await post(
      book,
      "/ride/book",
      await booking({
        quote_token: await quoteToken({ scheduledAt: offGrid }),
      }),
      await asUser(),
    );
    expect(res).toEqual({
      status: 409,
      body: {
        error: "Pickup times are every 15 minutes. Please choose another time.",
        code: "slot_unavailable",
      },
    });
    expect(await rows`SELECT * FROM rides`).toHaveLength(0);
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("PT1: a card charged at once is marked paid at the charge time (latest_charge.created)", async () => {
    const chargedAt = Date.now() - 90_000;
    stripeBooks("succeeded", { chargedAtMs: chargedAt });
    await post(book, "/ride/book", await booking(), await asUser());
    expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith(
      "pi_1",
      expect.objectContaining({ expand: ["latest_charge"] }),
    );
    const [ride] = await rows`SELECT payment_status, paid_at FROM rides`;
    expect(ride.payment_status).toBe("paid");
    expect(ride.paid_at.getTime()).toBe(Math.floor(chargedAt / 1000) * 1000);
  });

  it("R09 E1: a declined card is a 402 with Stripe's message and a hidden failed ride", async () => {
    stripeBooks(stripeError("StripeCardError", "Your card was declined."));
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toEqual({
      status: 402,
      body: { error: "Your card was declined." },
    });
    expect(await statuses()).toEqual(["failed"]);
    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(await history()).toEqual([]);
  });

  it("E2: a card Stripe rejects outright is a 400 card_rejected (no internals leaked; the error is logged) and a failed ride", async () => {
    const rejected = stripeError(
      "StripeInvalidRequestError",
      "No such PaymentMethod: pm_x",
    );
    stripeBooks(rejected);
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toEqual({
      status: 400,
      body: {
        error: "The payment could not be processed. Please try another card.",
        code: "card_rejected",
      },
    });
    expect(console.error).toHaveBeenCalledWith(
      "ride 1: Stripe rejected the payment:",
      rejected,
    );
    expect(await statuses()).toEqual(["failed"]);
  });

  it("E3: a lost connection on confirm asks Stripe once — a charge that went through is a 200, paid at the charge time", async () => {
    stripeBooks(stripeError("StripeConnectionError"));
    const chargedAt = Date.now() - 30_000;
    stripeReports("succeeded", { chargedAtMs: chargedAt });
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toMatchObject({
      status: 200,
      body: { ride_id: 1, status: "succeeded" },
    });
    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    const [ride] = await rows`SELECT payment_status, paid_at FROM rides`;
    expect(ride.payment_status).toBe("paid");
    expect(ride.paid_at.getTime()).toBe(Math.floor(chargedAt / 1000) * 1000);
  });

  it("E3: … and a 3-D Secure challenge is handed to the app as usual", async () => {
    stripeBooks(stripeError("StripeAPIError"));
    stripeReports("requires_action");
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toMatchObject({
      status: 200,
      body: { status: "requires_action" },
    });
    expect(await statuses()).toEqual(["pending"]);
  });

  it("E3 P8: … otherwise the outcome is unknown: 502 payment_unknown naming the ride, which stays pending", async () => {
    stripeBooks(stripeError("StripeConnectionError"));
    mockStripe.paymentIntents.retrieve.mockRejectedValue(
      stripeError("StripeConnectionError"),
    );
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toEqual({ status: 502, body: PAYMENT_UNKNOWN });
    expect(await statuses()).toEqual(["pending"]);
  });

  it.each([["StripeAPIError"], ["StripeInvalidRequestError"]])(
    "E4: if creating the PaymentIntent fails (%s), nothing is charged: 502 not_charged, logged, and the ride is failed",
    async (type) => {
      const error = stripeError(type, "No valid account configuration");
      mockStripe.paymentIntents.create.mockRejectedValue(error);
      const res = await post(
        book,
        "/ride/book",
        await booking(),
        await asUser(),
      );
      expect(res).toEqual({
        status: 502,
        body: {
          error:
            "We couldn't start the payment, and nothing was charged. Please try again.",
          code: "not_charged",
        },
      });
      expect(console.error).toHaveBeenCalledWith(
        "ride 1: creating the PaymentIntent failed:",
        error,
      );
      expect(mockStripe.paymentIntents.confirm).not.toHaveBeenCalled();
      expect(
        (await rows`SELECT payment_status, payment_intent_id FROM rides`)[0],
      ).toEqual({
        payment_status: "failed",
        payment_intent_id: null,
      });
    },
  );

  it("E5: charged, but marking the ride paid failed → still 200, and settled on the next read", async () => {
    stripeBooks("succeeded");
    failOnce("SET payment_status = 'paid'");
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toMatchObject({ status: 200, body: { status: "succeeded" } });
    stripeReports("succeeded");
    expect((await history()).map((r) => r.payment_status)).toEqual(["paid"]);
  });

  it("K8: a second ride can be booked while another is live", async () => {
    stripeBooks("succeeded");
    await post(book, "/ride/book", await booking(), await asUser()); // live now
    const token = await quoteToken({ scheduledAt: slotIn(24 * 60) });
    const res = await post(
      book,
      "/ride/book",
      await booking({ quote_token: token }),
      await asUser(),
    );
    expect(res.status).toBe(200);
    expect((await history()).map((r) => r.ride_id).sort()).toEqual([1, 2]);
  });

  it("rejects an unknown driver before any Stripe call", async () => {
    const res = await post(
      book,
      "/ride/book",
      await booking({ driver_id: 999 }),
      await asUser(),
    );
    expect(res).toMatchObject({
      status: 400,
      body: { error: "That driver is no longer available" },
    });
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no payment method", { payment_method_id: undefined }],
    ["an over-long address", { origin_address: "x".repeat(256) }],
    ["a fractional driver id", { driver_id: 1.5 }],
  ])(
    "validates the body: %s → 400 before any Stripe call",
    async (_, overrides) => {
      const res = await post(
        book,
        "/ride/book",
        await booking(overrides),
        await asUser(),
      );
      expect(res.status).toBe(400);
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    },
  );

  it("E7: a missing quote-signing secret is a logged 500 that names no setting, before any INSERT or Stripe call", async () => {
    delete process.env.QUOTE_SIGNING_SECRET;
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toEqual({ status: 500, body: SERVER_FAULT });
    expect(console.error).toHaveBeenCalledWith(
      "Missing environment variable QUOTE_SIGNING_SECRET",
    );
    expect(await rows`SELECT * FROM rides`).toHaveLength(0);
    expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe("POST /ride/confirm", () => {
  async function bookPending(userId = "user_1") {
    stripeBooks("requires_action");
    return (
      await post(book, "/ride/book", await booking(), await asUser(userId))
    ).body.ride_id as number;
  }

  it("R05 PT1: marks the ride paid once Stripe says the payment succeeded, at the charge time", async () => {
    const rideId = await bookPending();
    const chargedAt = Date.now() - 90_000;
    stripeReports("succeeded", { chargedAtMs: chargedAt });
    const res = await post(
      confirm,
      "/ride/confirm",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      ride_id: rideId,
      payment_status: "paid",
      fare_price: 9.74,
    });
    expect(Date.parse(res.body.data.paid_at)).toBe(
      Math.floor(chargedAt / 1000) * 1000,
    );
    expect(res.body.data).not.toHaveProperty("payment_intent_id");
  });

  it("is idempotent: a second confirm returns the same ride without asking Stripe", async () => {
    const rideId = await bookPending();
    stripeReports("succeeded");
    const first = await post(
      confirm,
      "/ride/confirm",
      { ride_id: rideId },
      await asUser(),
    );
    const second = await post(
      confirm,
      "/ride/confirm",
      { ride_id: rideId },
      await asUser(),
    );
    expect(second).toEqual(first);
    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
  });

  it.each([
    "requires_action",
    "processing",
    "canceled",
    "requires_payment_method",
  ])("R05: leaves the ride unpaid when the payment is %s", async (status) => {
    const rideId = await bookPending();
    stripeReports(status);
    const res = await post(
      confirm,
      "/ride/confirm",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res).toMatchObject({
      status: 409,
      body: { code: "payment_incomplete" },
    });
    expect(await statuses()).toEqual(["pending"]);
  });

  it("R01: does not reveal or confirm another rider's ride", async () => {
    const rideId = await bookPending("user_1");
    const res = await post(
      confirm,
      "/ride/confirm",
      { ride_id: rideId },
      await asUser("user_2"),
    );
    expect(res.status).toBe(404);
    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("refuses a PaymentIntent that belongs to someone else", async () => {
    const rideId = await bookPending("user_1");
    stripeReports("succeeded", { userId: "user_2" });
    const res = await post(
      confirm,
      "/ride/confirm",
      { ride_id: rideId },
      await asUser("user_1"),
    );
    expect(res.status).toBe(404);
  });

  it("PT1: pays a failed ride whose PaymentIntent did succeed (safety net)", async () => {
    stripeBooks(stripeError("StripeCardError", "Your card was declined."));
    await post(book, "/ride/book", await booking(), await asUser());
    stripeReports("succeeded");
    const res = await post(
      confirm,
      "/ride/confirm",
      { ride_id: 1 },
      await asUser(),
    );
    expect(res.body.data.payment_status).toBe("paid");
  });

  it("refuses a failed ride that never reached Stripe", async () => {
    mockStripe.paymentIntents.create.mockRejectedValue(
      stripeError("StripeAPIError"),
    );
    await post(book, "/ride/book", await booking(), await asUser());
    expect(
      (await post(confirm, "/ride/confirm", { ride_id: 1 }, await asUser()))
        .status,
    ).toBe(409);
  });
});

describe("GET /rides", () => {
  it("R01: is a 401 without a session", async () => {
    expect((await get(rides, "/rides")).status).toBe(401);
  });

  it("R01: returns only the caller's rides", async () => {
    stripeBooks("succeeded");
    await post(book, "/ride/book", await booking(), await asUser("user_1"));
    await post(book, "/ride/book", await booking(), await asUser("user_2"));
    expect((await history("user_1")).map((r) => r.ride_id)).toEqual([1]);
    expect((await history("user_2")).map((r) => r.ride_id)).toEqual([2]);
  });

  it("R38: returns exactly the Ride wire shape, with numbers as numbers", async () => {
    stripeBooks("succeeded");
    await post(book, "/ride/book", await booking(), await asUser());
    const res = await get(rides, "/rides", await asUser());
    const [ride] = res.body.data;
    expect(Object.keys(ride).sort()).toEqual(
      [
        "cancelled_at",
        "created_at",
        "destination_address",
        "destination_latitude",
        "destination_longitude",
        "driver",
        "fare_price",
        "origin_address",
        "origin_latitude",
        "origin_longitude",
        "paid_at",
        "payment_status",
        "pickup_minutes",
        "ride_id",
        "ride_time",
        "scheduled_at",
      ].sort(),
    );
    for (const key of [
      "ride_id",
      "origin_latitude",
      "destination_longitude",
      "ride_time",
      "pickup_minutes",
      "fare_price",
    ]) {
      expect(typeof ride[key]).toBe("number");
    }
    expect(ride).toMatchObject({
      origin_latitude: 45.8,
      fare_price: 9.74,
      scheduled_at: null,
    });
    expect(ride.driver).toEqual({
      driver_id: 3,
      first_name: "Michael",
      last_name: "Johnson",
      profile_image_url: "https://randomuser.me/api/portraits/men/12.jpg",
      car_image_url: "https://placehold.co/320x180/png?text=Hatch",
      car_seats: 4,
      rating: 4.9,
    });
    expect(Date.parse(res.body.server_time)).not.toBeNaN();
  });

  describe("R05: the money invariant — every succeeded payment ↔ exactly one visible ride", () => {
    it("M1: 3-D Secure completed after 61 s, app killed before /ride/confirm → one paid ride, paid_at = charge time", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      await ageRides(1.02);
      const chargedAt = Date.now() - 5000;
      stripeReports("succeeded", { chargedAtMs: chargedAt });
      const data = await history();
      expect(data).toHaveLength(1);
      expect(data[0].payment_status).toBe("paid");
      expect(Date.parse(data[0].paid_at!)).toBe(
        Math.floor(chargedAt / 1000) * 1000,
      );
    });

    it("M2 PT4: died after the INSERT, before Stripe → invisible, Stripe never called, failed after 10 min", async () => {
      await insertPending(0);
      expect(await history()).toEqual([]);
      await ageRides(11);
      expect(await history()).toEqual([]);
      expect(await statuses()).toEqual(["failed"]);
      expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it("M3: died after creating the (unconfirmed) PaymentIntent, before saving it → never charged", async () => {
      stripeBooks("succeeded");
      failOnce("SET payment_intent_id");
      const res = await post(
        book,
        "/ride/book",
        await booking(),
        await asUser(),
      );
      expect(res.status).toBe(500);
      expect(mockStripe.paymentIntents.confirm).not.toHaveBeenCalled(); // no money moved
      await ageRides(11);
      expect(await history()).toEqual([]);
    });

    it("M4: unknown outcome on confirm while Stripe succeeded → 502, then paid on the next read", async () => {
      stripeBooks(stripeError("StripeConnectionError"));
      mockStripe.paymentIntents.retrieve.mockRejectedValueOnce(
        stripeError("StripeConnectionError"),
      );
      const res = await post(
        book,
        "/ride/book",
        await booking(),
        await asUser(),
      );
      expect(res.status).toBe(502);
      stripeReports("succeeded");
      expect((await history()).map((r) => r.payment_status)).toEqual(["paid"]);
    });

    it("M5: confirm and history racing still yield exactly one paid ride", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      stripeReports("succeeded");
      const token = await asUser();
      const [confirmed, listed] = await Promise.all([
        post(confirm, "/ride/confirm", { ride_id: 1 }, token),
        get(rides, "/rides", token),
      ]);
      expect(confirmed.status).toBe(200);
      expect(listed.status).toBe(200);
      expect(await statuses()).toEqual(["paid"]);
    });

    it("M6 PT3: an abandoned 3-D Secure challenge is cancelled at Stripe and hidden after 30 min", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      stripeReports("requires_action");
      expect(await history()).toEqual([]); // pending is never shown as a ride
      expect(mockStripe.paymentIntents.cancel).not.toHaveBeenCalled();
      await ageRides(31);
      await history();
      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_1");
      expect(await statuses()).toEqual(["failed"]);
    });

    it("PT4: a reservation without a PaymentIntent stays pending at 9 min and fails at 11 min", async () => {
      await insertPending(9);
      await insertPending(11);
      expect(await history()).toEqual([]);
      expect(await statuses()).toEqual(["pending", "failed"]);
      expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    it("PT4b: a PaymentIntent Stripe does not know (resource_missing) keeps the ride pending for 10 min, then fails it", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      mockStripe.paymentIntents.retrieve.mockRejectedValue(
        Object.assign(
          stripeError(
            "StripeInvalidRequestError",
            "No such payment_intent: 'pi_1'",
          ),
          { code: "resource_missing" },
        ),
      );
      await ageRides(9);
      expect(await history()).toEqual([]);
      expect(await statuses()).toEqual(["pending"]);
      await ageRides(11);
      expect(await history()).toEqual([]);
      expect(await statuses()).toEqual(["failed"]);
      expect(mockStripe.paymentIntents.cancel).not.toHaveBeenCalled();
    });

    it("PT3b: a payment still processing after 30 min is never cancelled (Stripe refuses) and stays pending", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      stripeReports("processing");
      await ageRides(31);
      expect(await history()).toEqual([]);
      expect(mockStripe.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(await statuses()).toEqual(["pending"]);
    });

    it("PT3: a cancel Stripe refuses (3-D Secure finished meanwhile) is logged with the ride id; the ride stays pending and is paid on a later read", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      stripeReports("requires_action");
      await ageRides(31);
      const refused = stripeError(
        "StripeInvalidRequestError",
        "You cannot cancel this PaymentIntent because it has a status of succeeded.",
      );
      mockStripe.paymentIntents.cancel.mockRejectedValue(refused);
      expect(await history()).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        "ride 1: could not cancel abandoned PaymentIntent pi_1:",
        refused,
      );
      expect(await statuses()).toEqual(["pending"]);
      stripeReports("succeeded");
      expect((await history()).map((r) => r.payment_status)).toEqual(["paid"]);
    });

    it("PT2: a PaymentIntent canceled at Stripe fails the ride on the next read", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      stripeReports("canceled");
      expect(await history()).toEqual([]);
      expect(await statuses()).toEqual(["failed"]);
      expect(mockStripe.paymentIntents.cancel).not.toHaveBeenCalled(); // already canceled
    });

    it("M7: history still loads when Stripe is down (reconcile is best effort)", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser());
      mockStripe.paymentIntents.retrieve.mockRejectedValue(
        stripeError("StripeConnectionError"),
      );
      const res = await get(rides, "/rides", await asUser());
      expect(res).toMatchObject({ status: 200, body: { data: [] } });
      expect(await statuses()).toEqual(["pending"]);
    });

    it("M7: a Stripe that never answers holds history for exactly the 2 s budget, with all 3 rows asked at once", async () => {
      stripeBooks("requires_action");
      for (let i = 0; i < 3; i++)
        await post(book, "/ride/book", await booking(), await asUser());
      const sql = recordSql();
      const readHistory = () => sql.some((q) => q.includes("JOIN drivers"));
      let readAt1999ms: boolean | undefined;
      mockStripe.paymentIntents.retrieve
        .mockImplementationOnce(() => {
          fakeTimersOnly(); // the budget is armed right after these calls
          setImmediate(() => {
            jest.advanceTimersByTime(1999);
            setImmediate(() => {
              readAt1999ms = readHistory();
              jest.advanceTimersByTime(1);
              jest.useRealTimers();
            });
          });
          return new Promise(() => {});
        })
        .mockImplementation(() => new Promise(() => {}));
      const res = await get(rides, "/rides", await asUser());
      expect(readAt1999ms).toBe(false);
      expect(res).toMatchObject({ status: 200, body: { data: [] } });
      expect(retrievedIds()).toEqual(["pi_3", "pi_2", "pi_1"]); // in parallel, newest first
      expect(await statuses()).toEqual(["pending", "pending", "pending"]);
    });

    it("M7 M10: asks Stripe about at most 3 pending rows per read — never checked first (newest first), then least recently checked, then oldest — so rows take turns", async () => {
      for (const age of [5, 20, 1, 15, 10])
        await insertPending(age, `pi_age${age}`);
      stripeReports("requires_action"); // young: every row stays pending
      await history();
      expect(retrievedIds()).toEqual(["pi_age1", "pi_age5", "pi_age10"]);
      mockStripe.paymentIntents.retrieve.mockClear();
      await history();
      // The two never checked (newest first), then the oldest of the three checked together.
      expect(retrievedIds()).toEqual(["pi_age15", "pi_age20", "pi_age10"]);
    });

    it("M10: three stuck pending rows (retrieve always throws) and one newer charged ride → the charged ride is paid and visible on the first history read", async () => {
      stripeBooks("requires_action");
      for (let i = 0; i < 4; i++)
        await post(book, "/ride/book", await booking(), await asUser());
      mockStripe.paymentIntents.retrieve.mockImplementation(async (id) => {
        if (id !== "pi_4") throw stripeError("StripeAPIError");
        return { id, status: "succeeded", latest_charge: null };
      });
      expect(
        (await history()).map((r) => [r.ride_id, r.payment_status]),
      ).toEqual([[4, "paid"]]);
      expect(retrievedIds()).toEqual(["pi_4", "pi_3", "pi_2"]);
      await history(); // ride 1's turn, then the two least recently checked
      expect(retrievedIds()).toEqual([
        "pi_4",
        "pi_3",
        "pi_2",
        "pi_1",
        "pi_2",
        "pi_3",
      ]);
      expect(await statuses()).toEqual([
        "pending",
        "pending",
        "pending",
        "paid",
      ]);
    });

    it("M11: more than 100 failed attempts after a paid ride never push it out of history", async () => {
      stripeBooks("succeeded");
      await post(book, "/ride/book", await booking(), await asUser());
      await ageRides(60);
      await rows`INSERT INTO rides (origin_address, destination_address, origin_latitude, origin_longitude,
        destination_latitude, destination_longitude, ride_time, pickup_minutes, fare_price, payment_status,
        driver_id, user_id)
        SELECT 'A', 'B', 45.8, 15.9, 45.81, 15.97, 10, 5, 9.74, 'failed', 1, 'user_1'
        FROM generate_series(1, 101)`;
      expect((await history()).map((r) => r.ride_id)).toEqual([1]);
    });

    it("M8: failed rides never crowd out an older pending ride that was charged", async () => {
      stripeBooks("requires_action");
      await post(book, "/ride/book", await booking(), await asUser()); // ride 1: charged later
      stripeBooks(stripeError("StripeCardError", "declined"));
      for (let i = 0; i < 3; i++)
        await post(book, "/ride/book", await booking(), await asUser());
      stripeReports("succeeded");
      expect((await history()).map((r) => r.ride_id)).toEqual([1]);
      expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledTimes(1); // failed rows untouched
    });

    it("M9: a refunded ride stays refunded, though its PaymentIntent still says succeeded", async () => {
      stripeBooks("succeeded");
      const token = await quoteToken({ scheduledAt: slotIn(24 * 60) });
      await post(
        book,
        "/ride/book",
        await booking({ quote_token: token }),
        await asUser(),
      );
      mockStripe.refunds.create.mockResolvedValue(REFUNDED);
      await post(cancel, "/ride/cancel", { ride_id: 1 }, await asUser());
      stripeReports("succeeded");
      expect((await history()).map((r) => r.payment_status)).toEqual([
        "refunded",
      ]);
    });
  });
});

describe("nextPaymentState — the transition table", () => {
  it.each([
    ["PT1", "succeeded", 0, "paid"],
    ["PT2", "canceled", 0, "failed"],
    ["PT3", "requires_action", 29 * MIN, "pending"],
    ["PT3", "requires_action", 31 * MIN, "cancel"],
    ["PT3b", "processing", 31 * MIN, "pending"],
    ["PT3", "requires_payment_method", 5 * MIN, "pending"],
    ["PT3", "requires_confirmation", 31 * MIN, "cancel"],
  ] as const)("%s: %s after %p ms → %s", (_, status, age, next) => {
    expect(nextPaymentState(status, age)).toBe(next);
  });
});

describe("POST /ride/cancel", () => {
  async function bookScheduled(inMinutes: number, userId = "user_1") {
    stripeBooks("succeeded");
    const token = await quoteToken({ scheduledAt: slotIn(inMinutes) });
    return (
      await post(
        book,
        "/ride/book",
        await booking({ quote_token: token }),
        await asUser(userId),
      )
    ).body.ride_id as number;
  }

  it("X1: refunds a scheduled ride before the driver sets off, with a new idempotency key per attempt", async () => {
    const rideId = await bookScheduled(24 * 60);
    mockStripe.refunds.create.mockResolvedValue(REFUNDED);
    const res = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ payment_status: "refunded" });
    expect(res.body.data.cancelled_at).not.toBeNull();
    expect(mockStripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: `pi_${rideId}` },
      {
        idempotencyKey: expect.stringMatching(
          new RegExp(`^refund-pi_${rideId}-[0-9a-f-]{36}$`),
        ),
      },
    );
    expect((await history()).map((r) => r.payment_status)).toEqual([
      "refunded",
    ]);
  });

  it("X2: is idempotent — cancelling twice refunds once", async () => {
    const rideId = await bookScheduled(24 * 60);
    mockStripe.refunds.create.mockResolvedValue(REFUNDED);
    const first = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    const second = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(second).toEqual(first);
    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("X3 K7: refuses rides booked for now", async () => {
    stripeBooks("succeeded");
    const rideId = (
      await post(book, "/ride/book", await booking(), await asUser())
    ).body.ride_id;
    const res = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res).toMatchObject({
      status: 409,
      body: { error: "Rides booked for now can't be cancelled" },
    });
  });

  it("X4: refuses once the driver has set off", async () => {
    const rideId = await bookScheduled(24 * 60);
    await rows`UPDATE rides SET scheduled_at = now() + interval '2 minutes'`; // departs pickup_minutes before
    const res = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res).toMatchObject({
      status: 409,
      body: { code: "not_cancellable" },
    });
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a rate limit", stripeError("StripeRateLimitError")],
    [
      "a rejected request (a disputed charge)",
      Object.assign(
        stripeError("StripeInvalidRequestError", "Charge ch_1 is disputed."),
        { code: "charge_disputed" },
      ),
    ],
  ])(
    "X5: a refund Stripe refuses (%s) is a logged 502 with refund copy; the ride stays booked and its cancel request is dropped",
    async (_, error) => {
      const rideId = await bookScheduled(24 * 60);
      mockStripe.refunds.create.mockRejectedValue(error);
      const res = await post(
        cancel,
        "/ride/cancel",
        { ride_id: rideId },
        await asUser(),
      );
      expect(res).toEqual({ status: 502, body: { error: REFUND_FAILED } });
      expect(console.error).toHaveBeenCalledWith(
        `ride ${rideId}: refund failed:`,
        error,
      );
      expect(await cancelState()).toEqual({
        payment_status: "paid",
        cancelled: false,
        requested: false,
      });
      expect(mockStripe.refunds.list).not.toHaveBeenCalled(); // a refusal is not unknown
    },
  );

  it.each([["failed"], ["canceled"]])(
    "X5: a refund Stripe reports as %s is a logged 502, and the ride stays booked",
    async (status) => {
      const rideId = await bookScheduled(24 * 60);
      mockStripe.refunds.create.mockResolvedValue({ id: "re_1", status });
      const res = await post(
        cancel,
        "/ride/cancel",
        { ride_id: rideId },
        await asUser(),
      );
      expect(res).toEqual({ status: 502, body: { error: REFUND_FAILED } });
      expect(console.error).toHaveBeenCalledWith(
        `ride ${rideId}: refund re_1 is ${status}`,
      );
      expect(await cancelState()).toEqual({
        payment_status: "paid",
        cancelled: false,
        requested: false,
      });
    },
  );

  it("X5: after a failed refund, trying again (with a new key) refunds and cancels the ride", async () => {
    const rideId = await bookScheduled(24 * 60);
    mockStripe.refunds.create
      .mockRejectedValueOnce(stripeError("StripeRateLimitError"))
      .mockResolvedValueOnce(REFUNDED);
    const token = await asUser();
    const first = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      token,
    );
    const retry = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      token,
    );
    expect(first.status).toBe(502);
    expect(retry).toMatchObject({
      status: 200,
      body: { data: { payment_status: "refunded" } },
    });
    const [firstKey, retryKey] = mockStripe.refunds.create.mock.calls.map(
      (call) => call[1].idempotencyKey,
    );
    expect(retryKey).not.toBe(firstKey);
  });

  it("X6 R01: does not cancel another rider's ride, or an unknown one", async () => {
    const rideId = await bookScheduled(24 * 60, "user_1");
    expect(
      (
        await post(
          cancel,
          "/ride/cancel",
          { ride_id: rideId },
          await asUser("user_2"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          cancel,
          "/ride/cancel",
          { ride_id: 999 },
          await asUser("user_1"),
        )
      ).status,
    ).toBe(404);
  });

  it("X7: refunded already (e.g. in the dashboard) → the cancel completes", async () => {
    const rideId = await bookScheduled(24 * 60);
    mockStripe.refunds.create.mockRejectedValue(
      Object.assign(
        stripeError("StripeInvalidRequestError", "already refunded"),
        {
          code: "charge_already_refunded",
        },
      ),
    );
    const res = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res).toMatchObject({
      status: 200,
      body: { data: { payment_status: "refunded" } },
    });
  });

  it("X8: refund done but the DB write failed → the retry's refund is refused as charge_already_refunded (X7), and the cancel completes", async () => {
    const rideId = await bookScheduled(24 * 60);
    mockStripe.refunds.create
      .mockResolvedValueOnce(REFUNDED)
      .mockRejectedValueOnce(
        Object.assign(
          stripeError(
            "StripeInvalidRequestError",
            "Charge ch_1 has already been refunded.",
          ),
          { code: "charge_already_refunded" },
        ),
      );
    failOnce("SET cancelled_at");
    expect(
      (await post(cancel, "/ride/cancel", { ride_id: rideId }, await asUser()))
        .status,
    ).toBe(500);
    const retry = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(retry).toMatchObject({
      status: 200,
      body: { data: { payment_status: "refunded" } },
    });
    expect(retry.body.data.cancelled_at).not.toBeNull();
    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(2); // one refund, one refusal
  });

  it.each([
    ["/ride/confirm", confirm],
    ["/ride/cancel", cancel],
  ])(
    "X6: %s with an id beyond Postgres int (2147483648) is a 400 naming the field, not a 500",
    async (path, handler) => {
      const res = await post(
        handler,
        path,
        { ride_id: 2_147_483_648 },
        await asUser(),
      );
      expect(res).toEqual({
        status: 400,
        body: { error: "ride_id must be between 1 and 2147483647" },
      });
    },
  );

  it.each([
    ["an API error (a Stripe 5xx)", stripeError("StripeAPIError"), "succeeded"],
    ["a lost connection", stripeError("StripeConnectionError"), "succeeded"],
    [
      "an idempotency conflict",
      stripeError("StripeIdempotencyError"),
      "succeeded",
    ],
    [
      "an error without a Stripe type",
      new Error("socket hang up"),
      "succeeded",
    ],
    [
      "a lost connection, the refund still pending",
      stripeError("StripeConnectionError"),
      "pending",
    ],
  ])(
    "X20: a refund whose outcome is unknown (%s) is checked with Stripe once; one that went through → 200 refunded",
    async (_, error, refundStatus) => {
      const rideId = await bookScheduled(24 * 60);
      mockStripe.refunds.create.mockRejectedValue(error);
      stripeShowsRefunds(refundStatus);
      const res = await post(
        cancel,
        "/ride/cancel",
        { ride_id: rideId },
        await asUser(),
      );
      expect(res).toMatchObject({
        status: 200,
        body: { data: { ride_id: rideId, payment_status: "refunded" } },
      });
      expect(res.body.data.cancelled_at).not.toBeNull();
      expect(mockStripe.refunds.list.mock.calls).toEqual([
        [{ payment_intent: `pi_${rideId}`, limit: 1 }],
      ]);
      expect(console.error).toHaveBeenCalledWith(
        `ride ${rideId}: refund outcome unknown:`,
        error,
      );
      expect(await cancelState()).toEqual({
        payment_status: "refunded",
        cancelled: true,
        requested: false,
      });
    },
  );

  it("X21: an unknown refund outcome with no refund at Stripe yet is a 504 refund_unknown, never 'didn't go through'; the ride stays paid and its cancel request stays open", async () => {
    const rideId = await bookScheduled(24 * 60);
    mockStripe.refunds.create.mockRejectedValue(stripeError("StripeAPIError"));
    stripeShowsRefunds();
    const res = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res).toEqual({ status: 504, body: REFUND_UNKNOWN });
    expect(await cancelState()).toEqual({
      payment_status: "paid",
      cancelled: false,
      requested: true,
    });
  });

  it.each([
    ["shows only a failed refund", () => stripeShowsRefunds("failed")],
    [
      "fails too",
      () =>
        mockStripe.refunds.list.mockRejectedValue(
          stripeError("StripeConnectionError"),
        ),
    ],
  ])(
    "X21: a check that %s leaves the outcome unknown: 504 refund_unknown, the cancel request kept",
    async (_, arrangeCheck) => {
      const rideId = await bookScheduled(24 * 60);
      mockStripe.refunds.create.mockRejectedValue(
        stripeError("StripeConnectionError"),
      );
      arrangeCheck();
      const res = await post(
        cancel,
        "/ride/cancel",
        { ride_id: rideId },
        await asUser(),
      );
      expect(res).toEqual({ status: 504, body: REFUND_UNKNOWN });
      expect((await cancelState()).requested).toBe(true);
    },
  );

  it("X21: a check that never answers is abandoned after 2 s: 504 refund_unknown", async () => {
    const rideId = await bookScheduled(24 * 60);
    mockStripe.refunds.create.mockRejectedValue(
      stripeError("StripeConnectionError"),
    );
    mockStripe.refunds.list.mockImplementation(() => {
      // Fake only the clock the route arms next to this call, then let 2 s pass.
      fakeTimersOnly();
      setImmediate(() => jest.advanceTimersByTime(2000));
      return new Promise(() => {});
    });
    const res = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    jest.useRealTimers();
    expect(res).toEqual({ status: 504, body: REFUND_UNKNOWN });
  });

  it.each([
    ["pending (3-D Secure unfinished)", "requires_action"],
    [
      "failed (declined)",
      stripeError("StripeCardError", "Your card was declined."),
    ],
  ])(
    "X22: a scheduled ride whose payment is %s is not booked: 409 not_booked, and no refund is asked for",
    async (_, outcome) => {
      stripeBooks(outcome);
      const token = await quoteToken({ scheduledAt: slotIn(24 * 60) });
      await post(
        book,
        "/ride/book",
        await booking({ quote_token: token }),
        await asUser(),
      );
      const before = await statuses();
      const res = await post(
        cancel,
        "/ride/cancel",
        { ride_id: 1 },
        await asUser(),
      );
      expect(res).toEqual({
        status: 409,
        body: {
          error:
            "This ride's payment hasn't completed, so there is nothing to cancel.",
          code: "not_booked",
        },
      });
      expect(mockStripe.refunds.create).not.toHaveBeenCalled();
      expect(await statuses()).toEqual(before);
      expect((await cancelState()).requested).toBe(false);
    },
  );
});

describe("X23: a cancel whose answer was lost is settled by the next history read", () => {
  async function bookScheduled() {
    stripeBooks("succeeded");
    const token = await quoteToken({ scheduledAt: slotIn(24 * 60) });
    return (
      await post(
        book,
        "/ride/book",
        await booking({ quote_token: token }),
        await asUser(),
      )
    ).body.ride_id as number;
  }
  /** X21: the refund's outcome is unknown and Stripe shows no refund yet. */
  async function cancelUnknown(rideId: number) {
    mockStripe.refunds.create.mockRejectedValue(stripeError("StripeAPIError"));
    stripeShowsRefunds();
    const res = await post(
      cancel,
      "/ride/cancel",
      { ride_id: rideId },
      await asUser(),
    );
    expect(res.status).toBe(504);
  }

  it("X23: after X21, the next history read shows the ride cancelled and refunded once Stripe shows the refund", async () => {
    const rideId = await bookScheduled();
    await cancelUnknown(rideId);
    stripeShowsRefunds("succeeded");
    const [ride] = await history();
    expect(ride).toMatchObject({ ride_id: rideId, payment_status: "refunded" });
    expect(ride.cancelled_at).not.toBeNull();
    expect(await cancelState()).toEqual({
      payment_status: "refunded",
      cancelled: true,
      requested: false,
    });
    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("X23 X8: refund made but the database write failed → the next history read shows the ride cancelled, with no second refund", async () => {
    const rideId = await bookScheduled();
    mockStripe.refunds.create.mockResolvedValue(REFUNDED);
    failOnce("SET cancelled_at");
    expect(
      (await post(cancel, "/ride/cancel", { ride_id: rideId }, await asUser()))
        .status,
    ).toBe(500);
    stripeShowsRefunds("succeeded");
    expect((await history()).map((r) => r.payment_status)).toEqual([
      "refunded",
    ]);
    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("X23: a request with no refund at Stripe is kept for 2 min, then dropped: the ride stays booked and later reads stop asking", async () => {
    const rideId = await bookScheduled();
    await cancelUnknown(rideId);
    mockStripe.refunds.list.mockClear();
    await rows`UPDATE rides SET cancel_requested_at = now() - interval '119 seconds'`;
    expect((await history()).map((r) => r.payment_status)).toEqual(["paid"]);
    expect((await cancelState()).requested).toBe(true);
    await rows`UPDATE rides SET cancel_requested_at = now() - interval '121 seconds'`;
    expect((await history()).map((r) => r.payment_status)).toEqual(["paid"]);
    expect(await cancelState()).toEqual({
      payment_status: "paid",
      cancelled: false,
      requested: false,
    });
    await history(); // a paid ride without an open cancel is never asked about
    expect(mockStripe.refunds.list).toHaveBeenCalledTimes(2);
    expect(mockStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("X23 M10: an open cancel is checked on the very next read, ahead of older never-checked pending rows", async () => {
    const rideId = await bookScheduled();
    // Booked an hour ago, and checked back then while its payment was pending.
    await rows`UPDATE rides SET created_at = now() - interval '1 hour',
      reconciled_at = now() - interval '1 hour'`;
    for (const [ageMinutes, intentId] of [
      [3, "pi_a"],
      [2, "pi_b"],
      [1, "pi_c"],
    ] as const)
      await insertPending(ageMinutes, intentId); // newer bookings, never checked
    await cancelUnknown(rideId);
    mockStripe.refunds.list.mockClear();
    stripeShowsRefunds("succeeded");
    stripeReports("requires_action");
    expect((await history()).map((r) => r.payment_status)).toEqual([
      "refunded",
    ]);
    expect(mockStripe.refunds.list).toHaveBeenCalledTimes(1);
    expect(retrievedIds()).toEqual(["pi_c", "pi_b"]); // the third waits its turn
  });

  it("X23: a check that fails is logged and retried on a later read; history still loads", async () => {
    const rideId = await bookScheduled();
    await cancelUnknown(rideId);
    const down = stripeError("StripeConnectionError");
    mockStripe.refunds.list.mockRejectedValue(down);
    expect((await history()).map((r) => r.payment_status)).toEqual(["paid"]);
    expect(console.warn).toHaveBeenCalledWith(
      `reconcile ride ${rideId}:`,
      down,
    );
    stripeShowsRefunds("succeeded");
    expect((await history()).map((r) => r.payment_status)).toEqual([
      "refunded",
    ]);
  });
});

describe("POST /ride/book — an inconclusive confirm (E3)", () => {
  it("E3: an error without a Stripe type (e.g. a dropped socket) is inconclusive too — Stripe is asked, and a charge that went through is a 200", async () => {
    stripeBooks(new Error("socket hang up"));
    stripeReports("succeeded");
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toMatchObject({
      status: 200,
      body: { ride_id: 1, status: "succeeded" },
    });
    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1", {
      expand: ["latest_charge"],
    });
    expect(await statuses()).toEqual(["paid"]);
  });

  it("E3: a payment Stripe still reports as processing stays unknown: 502 payment_unknown, ride kept pending", async () => {
    stripeBooks(stripeError("StripeConnectionError"));
    stripeReports("processing");
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toEqual({ status: 502, body: PAYMENT_UNKNOWN });
    expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    expect(await statuses()).toEqual(["pending"]);
  });

  it("E3: a status check that never answers is abandoned after 2 s: 502 payment_unknown, ride kept pending", async () => {
    stripeBooks(stripeError("StripeConnectionError"));
    mockStripe.paymentIntents.retrieve.mockImplementation(() => {
      // Fake only the clock the route arms next to this call, then let 2 s pass.
      fakeTimersOnly();
      setImmediate(() => jest.advanceTimersByTime(2000));
      return new Promise(() => {});
    });
    const res = await post(book, "/ride/book", await booking(), await asUser());
    jest.useRealTimers();
    expect(res).toMatchObject({
      status: 502,
      body: { code: "payment_unknown" },
    });
    expect(await statuses()).toEqual(["pending"]);
  });

  it.each([["requires_payment_method"], ["requires_confirmation"]])(
    "E3: a confirm that never took effect (%s) is cancelled at Stripe, so nothing can be charged: 502 not_charged, the ride failed",
    async (status) => {
      stripeBooks(stripeError("StripeConnectionError"));
      stripeReports(status);
      mockStripe.paymentIntents.cancel.mockResolvedValue({
        id: "pi_1",
        status: "canceled",
      });
      const res = await post(
        book,
        "/ride/book",
        await booking(),
        await asUser(),
      );
      expect(res).toEqual({ status: 502, body: NOT_CHARGED });
      expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_1");
      expect(await statuses()).toEqual(["failed"]);
      expect(await history()).toEqual([]);
    },
  );

  it("E3: a PaymentIntent Stripe already reports as canceled was not charged either: 502 not_charged, with no second cancel", async () => {
    stripeBooks(stripeError("StripeAPIError"));
    stripeReports("canceled");
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toEqual({ status: 502, body: NOT_CHARGED });
    expect(mockStripe.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(await statuses()).toEqual(["failed"]);
  });

  it("E3: a cancel Stripe refuses (the payment moved on meanwhile) leaves the outcome unknown: 502 payment_unknown, the ride kept pending", async () => {
    stripeBooks(stripeError("StripeConnectionError"));
    stripeReports("requires_payment_method");
    mockStripe.paymentIntents.cancel.mockRejectedValue(
      stripeError(
        "StripeInvalidRequestError",
        "You cannot cancel this PaymentIntent because it has a status of succeeded.",
      ),
    );
    const res = await post(book, "/ride/book", await booking(), await asUser());
    expect(res).toEqual({ status: 502, body: PAYMENT_UNKNOWN });
    expect(await statuses()).toEqual(["pending"]);
  });

  it("E3: the status check and the cancel share one 2 s budget: a cancel still unanswered when it runs out is unknown", async () => {
    stripeBooks(stripeError("StripeConnectionError"));
    mockStripe.paymentIntents.retrieve.mockImplementation(async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 50)); // real time passes
      return { id, status: "requires_payment_method", metadata: {} };
    });
    mockStripe.paymentIntents.cancel.mockImplementation(() => {
      // A fresh 2 s would outlast 1990 ms; what is left of the budget does not.
      fakeTimersOnly();
      setImmediate(() => jest.advanceTimersByTime(1990));
      return new Promise(() => {});
    });
    const res = await post(book, "/ride/book", await booking(), await asUser());
    jest.useRealTimers();
    expect(res).toEqual({ status: 502, body: PAYMENT_UNKNOWN });
    expect(await statuses()).toEqual(["pending"]);
  });
});
