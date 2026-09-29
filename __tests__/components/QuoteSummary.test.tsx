/**
 * The quote states above the driver list (Q1, Q2, Q4 of the build plan's WP2
 * table) and the scheduled-pickup header that replaces per-driver minutes.
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { ActivityIndicator } from "react-native";

import QuoteSummary from "@/components/QuoteSummary";
import { setServerTime } from "@/services/clock";
import { LoadStatus } from "@/types/type";

import { MIN } from "../helpers/rides";
import { colors } from "../helpers/tokens";

const NOW = Date.parse("2026-10-03T19:00:00.000Z"); // Saturday 21:00 in Zagreb
const SLOT = Date.parse("2026-10-04T06:00:00.000Z"); // Sunday 08:00 in Zagreb

function renderSummary(
  props: Partial<React.ComponentProps<typeof QuoteSummary>> = {},
) {
  const onRetry = jest.fn();
  render(
    <QuoteSummary
      status="ready"
      error={null}
      surgeMultiplier={1}
      scheduledAt={null}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onRetry };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  setServerTime(new Date(NOW).toISOString(), NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("QuoteSummary — Q1, Q2", () => {
  it("Q1: loading shows a spinner and 'Finding prices…', and no error or surge", () => {
    renderSummary({ status: "loading", surgeMultiplier: 1.4 });

    const loading = screen.getByTestId("quotes-loading");
    expect(loading).toHaveTextContent("Finding prices…");
    expect(within(loading).UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    expect(screen.queryByTestId("quotes-error")).toBeNull();
    expect(screen.queryByTestId("quote-surge")).toBeNull();
  });

  it("Q2: an error shows 'Couldn't get prices' with the server's message", () => {
    renderSummary({ status: "error", error: "Trips over 60 km aren't served" });

    const error = screen.getByTestId("quotes-error");
    expect(within(error).getByText("Couldn't get prices")).toBeOnTheScreen();
    expect(
      within(error).getByText("Trips over 60 km aren't served"),
    ).toHaveStyle({ color: colors.general["200"] });
    expect(screen.queryByTestId("quotes-loading")).toBeNull();
  });

  it("Q2: without a message, the error shows only the headline and Retry", () => {
    renderSummary({ status: "error", error: null });

    expect(screen.getByTestId("quotes-error")).toHaveTextContent(
      "Couldn't get pricesRetry",
    );
  });

  it("Q2: Retry calls onRetry once", () => {
    const { onRetry } = renderSummary({ status: "error", error: "Timeout" });

    fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(["idle", "ready"] as LoadStatus[])(
    "%s shows neither the loading nor the error state",
    (status) => {
      renderSummary({ status });

      expect(screen.queryByTestId("quotes-loading")).toBeNull();
      expect(screen.queryByTestId("quotes-error")).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    },
  );
});

describe("QuoteSummary — Q4 surge", () => {
  it("Q4: a surge of ×1.4 reads 'High demand · ×1.4' in warning-600", () => {
    renderSummary({ surgeMultiplier: 1.4 });

    const surge = screen.getByTestId("quote-surge");
    expect(surge).toHaveTextContent("High demand · ×1.4");
    expect(surge).toHaveStyle({ color: colors.warning["600"] });
  });

  it("Q4: the multiplier is shown to at most two decimals", () => {
    renderSummary({ surgeMultiplier: 1.2345 });

    expect(screen.getByTestId("quote-surge")).toHaveTextContent(
      "High demand · ×1.23",
    );
  });

  it.each([1, 0.9, null])("Q4: no surge line at ×%p", (surgeMultiplier) => {
    renderSummary({ surgeMultiplier });

    expect(screen.queryByTestId("quote-surge")).toBeNull();
    expect(screen.queryByText(/High demand/)).toBeNull();
  });

  it("Q4: no surge line while a new quote is loading, even if the last one surged", () => {
    renderSummary({ status: "loading", surgeMultiplier: 1.8 });

    expect(screen.queryByTestId("quote-surge")).toBeNull();
  });
});

describe("QuoteSummary — scheduled pickup header", () => {
  it("W5: a scheduled quote shows 'Pickup · Tomorrow · 08:00'", () => {
    renderSummary({ scheduledAt: SLOT });

    expect(screen.getByTestId("quote-pickup")).toHaveTextContent(
      "Pickup · Tomorrow · 08:00",
    );
  });

  it("W5: a ride now has no pickup header", () => {
    renderSummary({ scheduledAt: null });

    expect(screen.queryByTestId("quote-pickup")).toBeNull();
  });

  it("W5: the header keeps showing while the scheduled quote reloads", () => {
    renderSummary({ scheduledAt: SLOT, status: "loading" });

    expect(screen.getByTestId("quote-pickup")).toHaveTextContent(
      "Pickup · Tomorrow · 08:00",
    );
    expect(screen.getByTestId("quotes-loading")).toBeOnTheScreen();
  });

  it("the day is read from the server's clock, not the device's", () => {
    // The phone is 4 h slow: the server already sees Sunday 01:00 in Zagreb.
    setServerTime(new Date(NOW + 4 * 60 * MIN).toISOString(), NOW);

    renderSummary({ scheduledAt: SLOT });

    expect(screen.getByTestId("quote-pickup")).toHaveTextContent(
      "Pickup · Today · 08:00",
    );
  });
});
