/**
 * server/auth.ts — who is calling? (ADR-014)
 *
 * Verifies the Clerk session JWT from `Authorization: Bearer <token>` without a
 * network call, using the instance's PEM public key (`CLERK_JWT_KEY`, Clerk
 * dashboard → API keys → "JWT public key") and the platform's WebCrypto. This
 * is Clerk's documented manual verification:
 *
 *   header.alg === "RS256"  ·  RSASSA-PKCS1-v1_5/SHA-256 signature
 *   exp / nbf within ±5 s   ·  sub is a non-empty string
 *   iss === the Frontend API encoded in the publishable key
 *
 * Needs WebCrypto (`crypto.subtle`): Node 20+ on the server.
 *
 * Every failure is a 401; the token itself is never logged.
 */

import { HttpError, requireEnv, SERVER_FAULT } from "@/server/http";

const CLOCK_TOLERANCE_S = 5;

export interface AuthConfig {
  /** PEM public key; literal "\n" escapes (single-line .env values) are accepted. */
  jwtKey: string;
  /** Expected `iss`, e.g. "https://clever-cat-12.clerk.accounts.dev". */
  issuer: string;
}

/** "pk_test_Y2xldmVyLWNhdC0xMi5jbGVyay5hY2NvdW50cy5kZXYk" → "https://clever-cat-12.clerk.accounts.dev" */
export function issuerFromPublishableKey(key: string | undefined) {
  const encoded = key?.split("_").slice(2).join("_");
  if (!encoded) return null;
  try {
    const host = atob(encoded).replace(/\$$/, "");
    return host ? `https://${host}` : null;
  } catch {
    return null;
  }
}

function configFromEnv(): AuthConfig {
  const issuer = issuerFromPublishableKey(
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  if (!issuer) {
    // Fail closed: never accept tokens without checking who issued them.
    console.error("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or invalid");
    throw new HttpError(500, SERVER_FAULT); // E7
  }
  return {
    jwtKey: requireEnv(process.env.CLERK_JWT_KEY, "CLERK_JWT_KEY"),
    issuer,
  };
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJson(segment: string): Record<string, unknown> {
  const json = new TextDecoder().decode(base64UrlToBytes(segment));
  const value = JSON.parse(json);
  if (typeof value !== "object" || value === null)
    throw new Error("not an object");
  return value;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importPublicKey(pem: string): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is unavailable: run the API on Node 20+");
  }
  let key = keyCache.get(pem);
  if (!key) {
    const body = pem
      .replace(/\\n/g, "\n")
      .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
      .replace(/\s+/g, "");
    key = crypto.subtle.importKey(
      "spki",
      base64UrlToBytes(body),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keyCache.set(pem, key);
  }
  return key;
}

const unauthorized = () => new HttpError(401, "Please sign in again");

/** The Clerk user id (`sub`) of a verified session token. */
export async function verifySessionToken(
  token: string,
  config: AuthConfig,
  nowMs: number = Date.now(),
): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3) throw unauthorized();
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  let signature: Uint8Array;
  try {
    header = decodeJson(headerB64);
    payload = decodeJson(payloadB64);
    signature = base64UrlToBytes(signatureB64);
  } catch {
    throw unauthorized(); // not base64url or not JSON: a 401, never a 500
  }
  if (header.alg !== "RS256") throw unauthorized();

  let key: CryptoKey;
  try {
    key = await importPublicKey(config.jwtKey);
  } catch (error) {
    console.error("CLERK_JWT_KEY is not a valid PEM public key:", error);
    throw new HttpError(500, SERVER_FAULT); // E7
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw unauthorized();

  const nowS = nowMs / 1000;
  const { exp, nbf, sub, iss } = payload;
  if (typeof exp !== "number" || nowS > exp + CLOCK_TOLERANCE_S) {
    throw unauthorized();
  }
  if (typeof nbf === "number" && nowS < nbf - CLOCK_TOLERANCE_S) {
    throw unauthorized();
  }
  if (typeof sub !== "string" || sub === "") throw unauthorized();
  if (iss !== config.issuer) throw unauthorized();
  return sub;
}

/** The verified Clerk user id of the caller, or a 401. */
export async function requireUserId(
  request: Request,
  config: AuthConfig = configFromEnv(),
  nowMs: number = Date.now(),
): Promise<string> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw new HttpError(401, "Please sign in");
  return verifySessionToken(match[1], config, nowMs);
}
