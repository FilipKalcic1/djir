/**
 * @clerk/clerk-expo for client tests: `jest.mock("@clerk/clerk-expo", () => require("../helpers/mocks/clerk"))`.
 * `auth` is the signed-in session every hook sees; tests change it per case.
 */
export const auth = {
  userId: "user_1" as string | null,
  isSignedIn: true,
  getToken: jest.fn(async () => "session-token"),
  signOut: jest.fn(async () => {}),
};

export const useAuth = () => auth;
export const useUser = () => ({
  user: { firstName: "Ana", primaryEmailAddress: null },
});
export const useOAuth = jest.fn(() => ({ startOAuthFlow: jest.fn() }));

export function resetClerk() {
  Object.assign(auth, { userId: "user_1", isSignedIn: true });
  auth.getToken.mockReset().mockResolvedValue("session-token");
  auth.signOut.mockClear();
}
