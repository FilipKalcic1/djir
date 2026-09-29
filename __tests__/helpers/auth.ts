/**
 * A real RS256 key pair (WebCrypto) standing in for a Clerk instance, so the
 * JWT verification is tested with genuine signatures — not mocks.
 */
import type { AuthConfig } from "@/server/auth";

export const TEST_ISSUER = "https://clever-cat-12.clerk.accounts.dev";
export const TEST_PUBLISHABLE_KEY = `pk_test_${btoa("clever-cat-12.clerk.accounts.dev$")}`;

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const json = (value: object) =>
  b64url(new TextEncoder().encode(JSON.stringify(value)));

let keysPromise: Promise<{ privateKey: CryptoKey; pem: string }> | null = null;

export function testKeys() {
  keysPromise ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
    const body = Buffer.from(spki)
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n");
    return {
      privateKey: pair.privateKey,
      pem: `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`,
    };
  })();
  return keysPromise;
}

export async function testAuthConfig(
  overrides: Partial<AuthConfig> = {},
): Promise<AuthConfig> {
  return { jwtKey: (await testKeys()).pem, issuer: TEST_ISSUER, ...overrides };
}

/** A session token like Clerk's, signed with the test key (or tampered with). */
export async function signTestJwt(
  claims: Record<string, unknown> = {},
  { alg = "RS256", nowMs = Date.now() }: { alg?: string; nowMs?: number } = {},
): Promise<string> {
  const nowS = Math.floor(nowMs / 1000);
  const header = json({ alg, typ: "JWT", kid: "ins_test" });
  const payload = json({
    sub: "user_1",
    iss: TEST_ISSUER,
    iat: nowS,
    nbf: nowS - 10,
    exp: nowS + 60,
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    (await testKeys()).privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Point the server env at the test Clerk instance. */
export async function applyTestAuthEnv() {
  process.env.CLERK_JWT_KEY = (await testKeys()).pem;
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = TEST_PUBLISHABLE_KEY;
}

export function jsonRequest(
  path: string,
  body?: unknown,
  token?: string,
  method = body === undefined ? "GET" : "POST",
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}
