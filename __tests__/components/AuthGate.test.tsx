/**
 * The (root) group guard: a signed-out deep link lands on the welcome screen
 * instead of a booking screen (R53).
 */
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import AuthGate from "@/components/AuthGate";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));

function renderGate(isSignedIn: boolean | undefined) {
  render(
    <AuthGate isSignedIn={isSignedIn}>
      <Text testID="protected">Book a ride</Text>
    </AuthGate>,
  );
}

describe("AuthGate", () => {
  it("R53: a signed-out rider is redirected to /(auth)/welcome and sees none of the screen", () => {
    renderGate(false);

    expect(screen.getByTestId("redirect")).toHaveTextContent("/(auth)/welcome");
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("R53: while Clerk has not decided (undefined), the rider is redirected too", () => {
    renderGate(undefined);

    expect(screen.getByTestId("redirect")).toHaveTextContent("/(auth)/welcome");
    expect(screen.queryByTestId("protected")).toBeNull();
  });

  it("R53: a signed-in rider sees the screen, with no redirect", () => {
    renderGate(true);

    expect(screen.getByTestId("protected")).toHaveTextContent("Book a ride");
    expect(screen.queryByTestId("redirect")).toBeNull();
  });
});
