/** lib/utils.ts — small display helpers shared by screens. */

/** "13 min" (ETAs round up), "1h 5m", or "—" when there is no value yet. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return "—";
  const rounded = Math.ceil(minutes);
  if (rounded < 60) return `${rounded} min`;
  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

/** A place's name without its city: "Trg bana Jelačića, Zagreb" → "Trg bana Jelačića". */
export function placeName(address: string): string {
  return address.split(",")[0].trim();
}

/** "€9.74" */
export function formatEur(amount: number): string {
  return `€${amount.toFixed(2)}`;
}

/** What the rider reads when a request could not reach its server at all. */
export const NETWORK_ERROR_MESSAGE =
  "Couldn't connect. Check your internet connection and try again.";

/**
 * A connection that failed, as React Native's fetch reports it ("Network
 * request failed") or as @clerk/clerk-js 6 wraps it ("ClerkJS: Network error
 * at <its own endpoint URL> …").
 */
const NETWORK_FAILURE = /^(ClerkJS: Network error|Network request failed)/;

/**
 * The message to show for an error from Clerk, fetch, or anything else; a
 * failed connection reads as NETWORK_ERROR_MESSAGE (R20).
 */
export function clerkErrorMessage(error: unknown, fallback: string): string {
  const clerk = (error as { errors?: { longMessage?: string }[] })?.errors;
  const message =
    clerk?.[0]?.longMessage ?? (error as { message?: unknown })?.message;
  if (typeof message !== "string" || !message) return fallback;
  return NETWORK_FAILURE.test(message) ? NETWORK_ERROR_MESSAGE : message;
}

interface NamedUser {
  firstName?: string | null;
  unsafeMetadata?: Record<string, unknown>;
  primaryEmailAddress?: { emailAddress: string } | null;
}

/** How to greet a user: their first name, the name given at sign-up, or their email. */
export function displayName(user: NamedUser | null | undefined): string {
  const signUpName = user?.unsafeMetadata?.name;
  return (
    user?.firstName ||
    (typeof signUpName === "string" && signUpName.trim().split(/\s+/)[0]) ||
    user?.primaryEmailAddress?.emailAddress.split("@")[0] ||
    "there"
  );
}

/**
 * What the sign-up form sends to Clerk. The name goes into `unsafeMetadata`,
 * which every Clerk instance accepts (first/last name fields may be disabled
 * in the dashboard), and `displayName` reads it back (R21).
 */
export function signUpParams(form: {
  name: string;
  email: string;
  password: string;
}) {
  const name = form.name.trim();
  return {
    emailAddress: form.email.trim(),
    password: form.password,
    ...(name ? { unsafeMetadata: { name } } : {}),
  };
}
