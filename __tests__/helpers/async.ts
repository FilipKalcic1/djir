/** Waiting helpers for client tests (hooks, components, screens). */
import { act } from "@testing-library/react-native";

// The real one: a test's fake timers must not stall the wait.
const { setImmediate: realSetImmediate } =
  jest.requireActual<typeof import("timers")>("timers");

/** Let pending promise chains, and the effects they trigger, run inside act. */
export const settle = () =>
  act(() => new Promise<void>((resolve) => realSetImmediate(resolve)));

/** A promise the test resolves or rejects when it chooses. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
