/** An HTTP error carrying the server's own message (`{ error }`) and body. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The machine-readable `code` a route sends with its error (`{ error, code }`,
 * e.g. `slot_unavailable`, `payment_unknown`), or null for anything else.
 */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const code = (error.body as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/** What a request that got no answer within its `timeoutMs` fails with. */
export const TIMEOUT_MESSAGE =
  "No answer from the server. Check your connection and try again.";

/**
 * How long a screen's load (the drivers, the ride history) may take. The
 * history's reconcile has a 2 s budget; the rest is room for a cold database.
 */
export const LOAD_TIMEOUT_MS = 10_000;

/**
 * How long a request waits for its Clerk session token. Offline,
 * @clerk/clerk-js 6 retries a token for about 2.7 minutes before it gives up
 * (8 retries, 3 s apart and growing), where 2.20 answered at once: a screen
 * waiting on it would spin all that time (H10, S2, P8, X9).
 */
export const TOKEN_TIMEOUT_MS = 10_000;

type FetchOptions = RequestInit & {
  /** Clerk session token; sent as `Authorization: Bearer …`. */
  token?: string | null;
  /**
   * Clerk's `getToken`, in place of `token`: read as the request starts. The
   * wait counts towards `timeoutMs`, and ends with TIMEOUT_MESSAGE after
   * TOKEN_TIMEOUT_MS at the latest, before anything is sent.
   */
  getToken?: () => Promise<string | null>;
  /**
   * Give up after this many ms: the request is aborted and fails with
   * TIMEOUT_MESSAGE, so a screen waiting on it shows its error state instead
   * of spinning forever. The caller's own `signal` still aborts it.
   */
  timeoutMs?: number;
};

/**
 * `fetch` for the app's own API routes. Resolves with the parsed JSON body and
 * throws an `ApiError` (with the server's message) on any non-2xx response.
 */
export async function fetchAPI<T = any>(
  url: string,
  { timeoutMs, ...options }: FetchOptions = {},
): Promise<T> {
  if (timeoutMs === undefined) return send<T>(url, options);

  // AbortSignal.timeout does not exist on Hermes (RN 0.74): combine by hand.
  const controller = new AbortController();
  const caller = options.signal;
  const abort = () => controller.abort();
  caller?.addEventListener("abort", abort);
  if (caller?.aborted) controller.abort(); // "abort" never fires again
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(TIMEOUT_MESSAGE)); // first, so the race reports it
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      send<T>(url, { ...options, signal: controller.signal }),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", abort);
  }
}

/** `promise`, or a rejection with TIMEOUT_MESSAGE if `ms` pass first. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function send<T>(
  url: string,
  { token, getToken, headers, ...init }: Omit<FetchOptions, "timeoutMs">,
): Promise<T> {
  const bearer = getToken ? await within(getToken(), TOKEN_TIMEOUT_MS) : token;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text; // e.g. an HTML error page from a proxy
  }

  if (!response.ok) {
    const serverMessage = (body as { error?: unknown } | null)?.error;
    throw new ApiError(
      typeof serverMessage === "string"
        ? serverMessage
        : `Request failed (HTTP ${response.status})`,
      response.status,
      body,
    );
  }
  return body as T;
}
