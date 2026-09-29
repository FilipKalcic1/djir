import {
  issuerFromPublishableKey,
  requireUserId,
  verifySessionToken,
} from "@/server/auth";
import { HttpError, SERVER_FAULT } from "@/server/http";

import {
  applyTestAuthEnv,
  jsonRequest,
  signTestJwt,
  TEST_ISSUER,
  TEST_PUBLISHABLE_KEY,
  testAuthConfig,
} from "../helpers/auth";

const NOW = Date.UTC(2026, 9, 3, 19, 0);
/** E7: the only 500 a rider can read; the log names the setting. */
const FAULT_500 = { name: "HttpError", status: 500, message: SERVER_FAULT };

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  await expect(promise).rejects.toMatchObject({ status });
}

// Restored even when a test fails half-way: a leaked Date.now or silenced
// console.error must never reach the next test.
afterEach(() => jest.restoreAllMocks());

describe("verifySessionToken", () => {
  it("accepts a genuine Clerk-style token and returns sub", async () => {
    const token = await signTestJwt({ sub: "user_42" }, { nowMs: NOW });
    await expect(
      verifySessionToken(token, await testAuthConfig(), NOW),
    ).resolves.toBe("user_42");
  });

  it.each([
    ["expired more than 5 s ago", { exp: NOW / 1000 - 6 }],
    ["not valid yet (nbf) by more than 5 s", { nbf: NOW / 1000 + 6 }],
    ["missing exp", { exp: undefined }],
    ["an empty sub", { sub: "" }],
    ["a numeric sub", { sub: 42 }],
    [
      "another Clerk instance's issuer",
      { iss: "https://evil.clerk.accounts.dev" },
    ],
  ])("rejects a token with %s", async (_, claims) => {
    const token = await signTestJwt(claims, { nowMs: NOW });
    await expectStatus(
      verifySessionToken(token, await testAuthConfig(), NOW),
      401,
    );
  });

  it("tolerates 5 s of clock skew on exp and nbf", async () => {
    const token = await signTestJwt(
      { exp: NOW / 1000 - 4, nbf: NOW / 1000 + 4 },
      { nowMs: NOW },
    );
    await expect(
      verifySessionToken(token, await testAuthConfig(), NOW),
    ).resolves.toBe("user_1");
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const [h, , s] = (await signTestJwt({}, { nowMs: NOW })).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        sub: "user_admin",
        exp: NOW / 1000 + 60,
        iss: TEST_ISSUER,
      }),
    ).toString("base64url");
    await expectStatus(
      verifySessionToken(`${h}.${forged}.${s}`, await testAuthConfig(), NOW),
      401,
    );
  });

  it("rejects any algorithm but RS256 (e.g. an HS256 or 'none' token)", async () => {
    for (const alg of ["HS256", "none"]) {
      const token = await signTestJwt({}, { alg, nowMs: NOW });
      await expectStatus(
        verifySessionToken(token, await testAuthConfig(), NOW),
        401,
      );
    }
  });

  it.each([["not-a-jwt"], ["a.b"], ["a.b.c.d"], ["!!.!!.!!"]])(
    "rejects garbage %p",
    async (token) => {
      await expectStatus(
        verifySessionToken(token, await testAuthConfig(), NOW),
        401,
      );
    },
  );

  it.each([["!!"], ["a"], ["%%%%"]])(
    "R01: a genuine header and payload with a signature %p that is not base64url is a 401, not a 500",
    async (signature) => {
      const [header, payload] = (await signTestJwt({}, { nowMs: NOW })).split(
        ".",
      );
      await expectStatus(
        verifySessionToken(
          `${header}.${payload}.${signature}`,
          await testAuthConfig(),
          NOW,
        ),
        401,
      );
    },
  );

  it("accepts a PEM pasted on one line with literal \\n escapes (.env style)", async () => {
    const config = await testAuthConfig();
    const oneLine = { ...config, jwtKey: config.jwtKey.replace(/\n/g, "\\n") };
    const token = await signTestJwt({}, { nowMs: NOW });
    await expect(verifySessionToken(token, oneLine, NOW)).resolves.toBe(
      "user_1",
    );
  });

  it("rejects a token whose header or payload is JSON but not an object", async () => {
    const [header, payload, signature] = (
      await signTestJwt({}, { nowMs: NOW })
    ).split(".");
    const encode = (json: string) => Buffer.from(json).toString("base64url");
    for (const token of [
      `${encode("null")}.${payload}.${signature}`,
      `${header}.${encode("42")}.${signature}`,
    ]) {
      await expectStatus(
        verifySessionToken(token, await testAuthConfig(), NOW),
        401,
      );
    }
  });

  it("reads the clock from Date.now() when none is passed", async () => {
    const token = await signTestJwt({}, { nowMs: NOW }); // exp = NOW + 60 s
    const config = await testAuthConfig();
    const clock = jest.spyOn(Date, "now").mockReturnValue(NOW + 66_000);
    await expectStatus(verifySessionToken(token, config), 401);
    clock.mockReturnValue(NOW);
    await expect(verifySessionToken(token, config)).resolves.toBe("user_1");
  });

  it("answers 500 when WebCrypto is unavailable (the API needs Node 20+)", async () => {
    const token = await signTestJwt({}, { nowMs: NOW });
    const config = await testAuthConfig();
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const crypto = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });
    try {
      await expectStatus(verifySessionToken(token, config, NOW), 500);
    } finally {
      Object.defineProperty(globalThis, "crypto", crypto);
    }
    expect(log).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        message: "WebCrypto is unavailable: run the API on Node 20+",
      }),
    );
  });

  it("E7: answers 500, not 401, when the configured key is not a public key — logged, and naming no setting", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const token = await signTestJwt({}, { nowMs: NOW });
    const broken = await testAuthConfig({
      jwtKey: "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----",
    });
    await expect(verifySessionToken(token, broken, NOW)).rejects.toMatchObject(
      FAULT_500,
    );
    expect(log).toHaveBeenCalledWith(
      "CLERK_JWT_KEY is not a valid PEM public key:",
      expect.objectContaining({ name: "DataError" }), // WebCrypto's DOMException
    );
  });
});

describe("requireUserId", () => {
  it("reads the Bearer token from the Authorization header", async () => {
    const token = await signTestJwt({ sub: "user_7" }, { nowMs: NOW });
    const request = jsonRequest("/rides", undefined, token);
    await expect(
      requireUserId(request, await testAuthConfig(), NOW),
    ).resolves.toBe("user_7");
  });

  it("is a 401 without a header", async () => {
    await expectStatus(
      requireUserId(jsonRequest("/rides"), await testAuthConfig(), NOW),
      401,
    );
  });

  describe("reading its configuration from the environment", () => {
    const saved = {
      jwtKey: process.env.CLERK_JWT_KEY,
      publishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    };
    let log: jest.SpyInstance;

    beforeEach(async () => {
      await applyTestAuthEnv();
      log = jest.spyOn(console, "error").mockImplementation(() => {});
    });
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    afterEach(() => {
      restore("CLERK_JWT_KEY", saved.jwtKey);
      restore("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", saved.publishableKey);
    });

    it("accepts a genuine token with the configured key and issuer", async () => {
      const token = await signTestJwt({ sub: "user_7" }, { nowMs: NOW });
      await expect(
        requireUserId(jsonRequest("/rides", undefined, token), undefined, NOW),
      ).resolves.toBe("user_7");
    });

    it("E7: an unset CLERK_JWT_KEY is a logged 500 that names no setting", async () => {
      delete process.env.CLERK_JWT_KEY;
      const token = await signTestJwt({}, { nowMs: NOW });
      await expect(
        requireUserId(jsonRequest("/rides", undefined, token), undefined, NOW),
      ).rejects.toMatchObject(FAULT_500);
      expect(log).toHaveBeenCalledWith(
        "Missing environment variable CLERK_JWT_KEY",
      );
    });

    it.each([
      ["missing", undefined],
      ["without its encoded host", "pk_test_"],
      ["not base64", "pk_test_%%%"],
      ["encoding an empty host", `pk_test_${btoa("$")}`],
    ])(
      "E7: fails closed with a logged 500 when the publishable key is %s — no token is accepted, and no setting is named",
      async (_, key) => {
        if (key === undefined)
          delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
        else process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = key;
        const genuine = await signTestJwt({}, { nowMs: NOW });
        await expect(
          requireUserId(
            jsonRequest("/rides", undefined, genuine),
            undefined,
            NOW,
          ),
        ).rejects.toMatchObject(FAULT_500);
        expect(log).toHaveBeenCalledWith(
          "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or invalid",
        );
      },
    );
  });
});

describe("issuerFromPublishableKey", () => {
  it("decodes the Frontend API host from the key", () => {
    expect(issuerFromPublishableKey(TEST_PUBLISHABLE_KEY)).toBe(TEST_ISSUER);
  });

  it.each([
    [undefined],
    ["pk_test_"],
    ["pk_test_%%%"],
    ["nonsense"],
    [`pk_test_${btoa("$")}`], // decodes to an empty host
  ])("is null for %p", (key) => {
    expect(issuerFromPublishableKey(key)).toBeNull();
  });
});
