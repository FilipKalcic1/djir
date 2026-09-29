/**
 * @stripe/stripe-react-native for client tests:
 * `jest.mock("@stripe/stripe-react-native", () => require("../helpers/mocks/stripe"))`.
 * `sheet` holds the Payment Sheet the component drives; `presentPaymentSheet`
 * runs the confirmHandler that `initPaymentSheet` received, like the SDK does.
 * `afterHandler` makes the sheet end badly although the handler answered with
 * a client secret (a 3-D Secure challenge closed, a network drop while the SDK
 * finishes the PaymentIntent) — the P9 case.
 */
import React from "react";

type Handler = (
  paymentMethod: { id: string },
  shouldSave: boolean,
  intentCreationCallback: (result: {
    clientSecret?: string;
    error?: unknown;
  }) => void,
) => void;

type AfterHandler = "Canceled" | "Failed";

/** How the SDK reports a sheet that ended without success after the handler's client secret. */
export const AFTER_HANDLER_ERRORS = {
  Canceled: { code: "Canceled", message: "The payment has been canceled" },
  Failed: {
    code: "Failed",
    message: "The payment could not be completed",
    localizedMessage: "The payment could not be completed.",
  },
} as const;

export const sheet = {
  handler: null as Handler | null,
  /**
   * What the card form "submits": a payment method (optionally ending badly
   * after the handler succeeded), or the rider closing the sheet first.
   */
  outcome: { paymentMethodId: "pm_card_visa" } as
    | { paymentMethodId: string; afterHandler?: AfterHandler }
    | { canceled: true },
  /** The result the handler gave the SDK on the last presentation. */
  lastResult: null as { clientSecret?: string; error?: unknown } | null,
};

export const initPaymentSheet = jest.fn(
  async (params: { intentConfiguration: { confirmHandler: Handler } }) => {
    sheet.handler = params.intentConfiguration.confirmHandler;
    return {};
  },
);

export const presentPaymentSheet = jest.fn(async () => {
  if ("canceled" in sheet.outcome) {
    return {
      error: { code: "Canceled", message: "The payment has been canceled" },
    };
  }
  const result = await new Promise<{ clientSecret?: string; error?: unknown }>(
    (resolve) =>
      sheet.handler!(
        { id: (sheet.outcome as { paymentMethodId: string }).paymentMethodId },
        false,
        resolve,
      ),
  );
  sheet.lastResult = result;
  if (result.error) return { error: result.error };
  const after = (sheet.outcome as { afterHandler?: AfterHandler }).afterHandler;
  return after ? { error: AFTER_HANDLER_ERRORS[after] } : {};
});

export const handleURLCallback = jest.fn(async () => true);

export const useStripe = () => ({
  initPaymentSheet,
  presentPaymentSheet,
  handleURLCallback,
});
export const StripeProvider = ({ children }: { children: React.ReactNode }) => (
  <>{children}</>
);

export function resetStripe() {
  Object.assign(sheet, {
    handler: null,
    outcome: { paymentMethodId: "pm_card_visa" },
    lastResult: null,
  });
  initPaymentSheet.mockClear();
  presentPaymentSheet.mockClear();
  handleURLCallback.mockClear();
}
