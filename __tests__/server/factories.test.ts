/**
 * server/db.ts and server/stripe.ts are thin lazy factories: each reads its
 * secret through requireEnv (a logged 500 when it is unset, E7) and
 * builds its client once, on first use — never at import time.
 */
const mockNeon = jest.fn();
jest.mock("@neondatabase/serverless", () => ({
  neon: (...args: unknown[]) => mockNeon(...args),
}));

const mockStripeClient = jest.fn();
jest.mock("stripe", () => ({
  __esModule: true,
  default: function Stripe(...args: unknown[]) {
    return mockStripeClient(...args);
  },
}));

type DbModule = typeof import("@/server/db");
type StripeModule = typeof import("@/server/stripe");

/** A fresh copy of the module, so its cached client starts empty. */
function load<T>(path: string): T {
  let mod: T | undefined;
  jest.isolateModules(() => {
    mod = require(path);
  });
  return mod!;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

const saved = {
  DATABASE_URL: process.env.DATABASE_URL,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
};
let log: jest.SpyInstance;

beforeEach(() => {
  mockNeon.mockReset();
  mockStripeClient.mockReset();
  log = jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  jest.restoreAllMocks();
});

describe("sql() — the Neon client", () => {
  const url = "postgres://djir:pw@ep-test.eu-central-1.aws.neon.tech/djir";

  it("connects nothing at import time", () => {
    process.env.DATABASE_URL = url;
    load<DbModule>("@/server/db");
    expect(mockNeon).not.toHaveBeenCalled();
  });

  it("connects with DATABASE_URL on first use, then reuses that client", () => {
    process.env.DATABASE_URL = url;
    const client = jest.fn();
    mockNeon.mockReturnValue(client);
    const { sql } = load<DbModule>("@/server/db");

    expect(sql()).toBe(client);
    expect(sql()).toBe(client);
    expect(mockNeon).toHaveBeenCalledTimes(1);
    expect(mockNeon).toHaveBeenCalledWith(url);
  });

  it("E7: an unset DATABASE_URL is a 500 that names no setting (only the log does), and caches nothing", () => {
    delete process.env.DATABASE_URL;
    const { sql } = load<DbModule>("@/server/db");

    expect(thrownBy(sql)).toMatchObject({
      name: "HttpError",
      status: 500,
      message: "Something went wrong on our side. Please try again later.",
    });
    expect(mockNeon).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Missing environment variable DATABASE_URL",
    );

    process.env.DATABASE_URL = url;
    mockNeon.mockReturnValue(jest.fn());
    sql();
    expect(mockNeon).toHaveBeenCalledWith(url);
  });
});

describe("stripe() — the Stripe server client", () => {
  const key = "sk_test_51Djir";
  // 10 s per call instead of the library's 80 s, at most 2 retries (E6).
  const options = { timeout: 10_000, maxNetworkRetries: 2 };

  it("creates nothing at import time", () => {
    process.env.STRIPE_SECRET_KEY = key;
    load<StripeModule>("@/server/stripe");
    expect(mockStripeClient).not.toHaveBeenCalled();
  });

  it("E6: creates the client with STRIPE_SECRET_KEY, a 10 s timeout and at most 2 retries on first use, then reuses it", () => {
    process.env.STRIPE_SECRET_KEY = key;
    const client = { paymentIntents: {} };
    mockStripeClient.mockReturnValue(client);
    const { stripe } = load<StripeModule>("@/server/stripe");

    expect(stripe()).toBe(client);
    expect(stripe()).toBe(client);
    expect(mockStripeClient).toHaveBeenCalledTimes(1);
    expect(mockStripeClient).toHaveBeenCalledWith(key, options);
  });

  it("E7: an unset STRIPE_SECRET_KEY is a 500 that names no setting (only the log does), and caches nothing", () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { stripe } = load<StripeModule>("@/server/stripe");

    expect(thrownBy(stripe)).toMatchObject({
      name: "HttpError",
      status: 500,
      message: "Something went wrong on our side. Please try again later.",
    });
    expect(mockStripeClient).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Missing environment variable STRIPE_SECRET_KEY",
    );

    process.env.STRIPE_SECRET_KEY = key;
    mockStripeClient.mockReturnValue({ paymentIntents: {} });
    stripe();
    expect(mockStripeClient).toHaveBeenCalledWith(key, options);
  });
});
