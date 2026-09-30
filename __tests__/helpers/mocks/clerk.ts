/**
 * @clerk/expo for client tests: `jest.mock("@clerk/expo", () => require("../helpers/mocks/clerk"))`.
 * The sign-in and sign-up screens' hooks come from @clerk/expo/legacy, which
 * their own tests mock.
 * `auth` is the signed-in session every hook sees; tests change it per case.
 * `clerk` is Clerk itself, loaded ("ready") unless a test says otherwise.
 */
import type { ReactNode } from "react";

export const auth = {
  userId: "user_1" as string | null,
  isSignedIn: true,
  getToken: jest.fn(async () => "session-token"),
  signOut: jest.fn(async () => {}),
};

export const clerk = {
  status: "ready" as "loading" | "ready" | "degraded" | "error",
};

export const useAuth = () => auth;
export const useClerk = () => clerk;
export const useUser = () => ({
  user: { firstName: "Ana", primaryEmailAddress: null },
});
export const useOAuth = jest.fn(() => ({ startOAuthFlow: jest.fn() }));

/** Its children while Clerk loads, as @clerk/expo's ClerkLoading renders them. */
export const ClerkLoading = ({ children }: { children: ReactNode }) =>
  clerk.status === "loading" ? children : null;

export function resetClerk() {
  Object.assign(auth, { userId: "user_1", isSignedIn: true });
  clerk.status = "ready";
  auth.getToken.mockReset().mockResolvedValue("session-token");
  auth.signOut.mockReset().mockResolvedValue(undefined);
}
