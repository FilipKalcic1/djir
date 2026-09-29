/**
 * expo-router for client tests: `jest.mock("expo-router", () => require("../helpers/mocks/expo-router"))`.
 * Navigation calls are recorded on `router`; <Redirect> renders its target so
 * a test can assert where a screen sent the rider; `refocus()` brings every
 * mounted screen back into focus.
 */
import { act } from "@testing-library/react-native";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  dismissAll: jest.fn(),
};

export const useLocalSearchParams = jest.fn(() => ({}));
/** The route on screen: "/" and no params unless a test says otherwise. */
export const usePathname = jest.fn(() => "/");
export const useGlobalSearchParams = jest.fn(
  (): Record<string, string> => ({}),
);

const focusListeners = new Set<() => void>();

/**
 * Like expo-router's hook: runs the effect when the screen gains focus (on
 * mount, and whenever the effect changes while focused), and again on each
 * `refocus()`.
 */
export function useFocusEffect(effect: () => void | (() => void)) {
  const [focusCount, setFocusCount] = useState(0);
  useEffect(() => {
    const listener = () => setFocusCount((n) => n + 1);
    focusListeners.add(listener);
    return () => {
      focusListeners.delete(listener);
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, [effect, focusCount]);
}

/** The rider comes back to every mounted screen (e.g. from the next one). */
export function refocus() {
  act(() => focusListeners.forEach((listener) => listener()));
}

export const Redirect = ({ href }: { href: string }) => (
  <Text testID="redirect">{href}</Text>
);

/** A navigator that renders nothing of its screens; `stack` shows it mounted. */
export const Stack = Object.assign(
  ({ children }: { children?: React.ReactNode }) => (
    <View testID="stack">{children}</View>
  ),
  { Screen: (_props: { name: string }) => null },
);

export function resetRouter() {
  Object.values(router).forEach((fn) => fn.mockReset());
  useLocalSearchParams.mockReset().mockReturnValue({});
  usePathname.mockReset().mockReturnValue("/");
  useGlobalSearchParams.mockReset().mockReturnValue({});
}
