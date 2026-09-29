/**
 * server/http.ts — the shape every API route shares.
 *
 *   export const POST = route(async (request) => { … return { data } });
 *
 * A handler returns a plain object (sent as 200 JSON) or a Response, and
 * signals failure by throwing: `HttpError` becomes `{ error }` with its status,
 * Stripe card errors become 402 with Stripe's message, other Stripe errors 502,
 * a rejected Stripe request 400, and anything unexpected is logged and
 * becomes a generic 500. Error messages
 * in `HttpError` are written for the user — the app shows them verbatim, so
 * a 500 never names a setting or an internal: the log does (E7).
 */

/** The body of every 500: what went wrong is in the server log, never in the app (E7). */
export const SERVER_FAULT =
  "Something went wrong on our side. Please try again later.";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type Handler<P> = (request: Request, params: P) => Promise<unknown>;

export function route<P = Record<string, string>>(handler: Handler<P>) {
  return async (request: Request, params: P): Promise<Response> => {
    try {
      const result = await handler(request, params);
      return result instanceof Response ? result : Response.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { error: error.message, ...error.extra },
      { status: error.status },
    );
  }
  const stripeType = (error as { type?: unknown })?.type;
  if (stripeType === "StripeCardError") {
    return Response.json({ error: (error as Error).message }, { status: 402 });
  }
  if (stripeType === "StripeInvalidRequestError") {
    console.error("Stripe rejected a request:", error);
    return Response.json(
      { error: "The payment could not be processed. Please try another card." },
      { status: 400 },
    );
  }
  if (typeof stripeType === "string" && stripeType.startsWith("Stripe")) {
    console.error("Stripe error:", error);
    return Response.json(
      { error: "The payment provider is unavailable. Please try again." },
      { status: 502 },
    );
  }
  console.error("Unhandled API error:", error);
  return Response.json({ error: SERVER_FAULT }, { status: 500 });
}

/** The request body as a JSON object; 400 for anything else. */
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/**
 * A server-side setting, or a logged 500 (E7): the log names the setting, the
 * rider only reads `SERVER_FAULT`. Pass `process.env.NAME` itself: Expo
 * inlines environment variables statically, so they cannot be read by a
 * dynamic name.
 */
export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    throw new HttpError(500, SERVER_FAULT);
  }
  return value;
}

/**
 * `work`'s result, or a rejection once `ms` have passed first (a bounded
 * check with Stripe: E3, X20). The timer is armed after `work` has started,
 * so a test's fake clock can own it, and it is always cleared.
 */
export async function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer within ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
