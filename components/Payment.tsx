import { useAuth } from "@clerk/expo";
import { StripeProvider, useStripe } from "@stripe/stripe-react-native";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { LatLng } from "@/lib/geo";
import { ENV_FILE, isStripePublishableKey } from "@/lib/setup";
import { formatEur } from "@/lib/utils";
import { apiErrorCode } from "@/services/api";
import { bookRide, confirmRide } from "@/services/booking";
import { makeConfirmHandler } from "@/services/payment";
import { fetchQuote } from "@/services/quotes";
import { SLOT_EXPIRED_NOTICE, useBookingStore, useDriverStore } from "@/store";
import { Ride, TripQuote } from "@/types/type";

/**
 * A quote older than this is refreshed before the sheet opens. The server
 * accepts 10 minutes, so at least 5 are left for entering a card.
 */
export const QUOTE_REFRESH_AFTER_MS = 5 * 60_000;

/**
 * Where the Payment Sheet sends the rider back after a 3-D Secure page (EG6):
 * the running app's own link, so it works in Expo Go
 * (`exp://<dev server>/--/stripe-redirect`) as in a build
 * (`djir://stripe-redirect`); app/stripe-redirect.tsx is its route.
 */
export const stripeReturnUrl = () => Linking.createURL("stripe-redirect");

/** The pay button's label: "Confirm Ride" for now, "Schedule Ride" for a later pickup (P1). */
const buttonLabelFor = (quote: TripQuote) =>
  quote.scheduledAt === null ? "Confirm Ride" : "Schedule Ride";

/** EG5: what Payment says when the app has no Stripe publishable key. */
export const PAYMENTS_NOT_SET_UP = `Payments aren't set up in this build: add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_…) to ${ENV_FILE} and restart npx expo start.`;

export interface PaymentProps {
  driverId: number;
  quote: TripQuote;
  pickup: LatLng;
  dropoff: LatLng;
  originAddress: string;
  destinationAddress: string;
  onBooked: (ride: Ride) => void;
  /** Paid, but the ride could not be confirmed yet (GET /rides will settle it). */
  onPaidUnconfirmed: () => void;
}

/** How a presented sheet reports that it ended without success. */
interface SheetEnd {
  code: string;
  message: string;
  localizedMessage?: string;
}

/**
 * "Confirm Ride": pay the signed quote with the Stripe Payment Sheet
 * (states P1–P9 of the build plan; the handler rules live in
 * services/payment.ts). The amount is exactly `quote.fareCents`, the integer
 * /ride/book charges, and the sheet is initialised before every presentation.
 */
const PaymentButton = ({
  driverId,
  quote,
  pickup,
  dropoff,
  originAddress,
  destinationAddress,
  onBooked,
  onPaidUnconfirmed,
}: PaymentProps) => {
  const { initPaymentSheet, presentPaymentSheet, handleURLCallback } =
    useStripe();
  const { getToken } = useAuth();
  const requestQuote = useDriverStore((s) => s.requestQuote);
  const quoteStatus = useDriverStore((s) => s.quoteStatus);
  const quoteError = useDriverStore((s) => s.quoteError);
  const expireSlot = useBookingStore((s) => s.expireSlot);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState(false);
  /** P8: the outcome is unknown; `rideId` is the ride that may be paid, when known. */
  const [unknown, setUnknown] = useState<{ rideId: number | null } | null>(
    null,
  );
  const [priceNotice, setPriceNotice] = useState<string | null>(null);
  const [requoteError, setRequoteError] = useState<string | null>(null);
  const awaitingFresh = useRef<number | null>(null); // the fare shown before refreshing
  const buttonLabel = buttonLabelFor(quote);

  // 3-D Secure may return to the app via its stripe-redirect link (EG6).
  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (url.includes("stripe-redirect")) handleURLCallback(url);
    });
    return () => subscription.remove();
  }, [handleURLCallback]);

  // P3: after a stale quote was refreshed, continue — or ask for a second tap
  // if the price changed.
  useEffect(() => {
    const previous = awaitingFresh.current;
    if (
      previous === null ||
      Date.now() - quote.issuedAtMs >= QUOTE_REFRESH_AFTER_MS
    ) {
      return;
    }
    awaitingFresh.current = null;
    if (quote.fareCents !== previous) {
      setPriceNotice(
        `Price updated: ${formatEur(previous / 100)} → ${formatEur(quote.fareCents / 100)}`,
      );
      setBusy(false);
    } else {
      pay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  // P3c: the refresh failed. The fare shown stays; say why, and a tap retries.
  useEffect(() => {
    if (awaitingFresh.current === null || quoteStatus !== "error") return;
    awaitingFresh.current = null;
    setRequoteError(
      quoteError
        ? `Couldn't refresh the price. ${quoteError}`
        : "Couldn't refresh the price.",
    );
    setBusy(false);
  }, [quoteStatus, quoteError]);

  // P8: when the server named the ride it may have charged, ask once whether
  // it was paid; if so it is booked (P6). Otherwise Rides settles it later.
  useEffect(() => {
    const rideId = unknown?.rideId ?? null;
    if (rideId === null) return;
    let active = true;
    confirmRide(rideId, getToken)
      .then((ride) => {
        if (active) onBooked(ride);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // Runs once per unknown outcome. getToken is a new function on every
    // render (@clerk/expo), but each one reads the current session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknown]);

  /** P6: the sheet succeeded — confirm the ride (3 idempotent attempts). */
  const finish = async (rideId: number) => {
    setBooked(true);
    try {
      onBooked(await confirmRide(rideId, getToken));
    } catch {
      onPaidUnconfirmed(); // P7
    } finally {
      setBusy(false);
    }
  };

  /**
   * P9: a ride was booked, but the sheet did not succeed (closed during
   * 3-D Secure, a network drop while the SDK finished). Ask the server once
   * whether it was paid before offering the button again.
   */
  const settle = async (rideId: number, end: SheetEnd) => {
    try {
      const ride = await confirmRide(rideId, getToken, { attempts: 1 });
      setBooked(true);
      onBooked(ride); // P6
    } catch (error) {
      if (apiErrorCode(error) !== "payment_incomplete") {
        setUnknown({ rideId }); // P8: never offer a second payment
      } else if (end.code !== "Canceled") {
        Alert.alert("Payment failed", end.localizedMessage ?? end.message); // P4
      } // P5: closed, nothing charged, nothing to say
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    setBusy(true);
    setPriceNotice(null);
    setRequoteError(null);
    const attempt = {
      rideId: null as number | null,
      outcomeUnknown: false,
      slotExpired: false,
    };

    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: "Djir",
      returnURL: stripeReturnUrl(),
      intentConfiguration: {
        mode: { amount: quote.fareCents, currencyCode: "eur" },
        paymentMethodTypes: ["card"],
        confirmHandler: makeConfirmHandler({
          platform: Platform.OS,
          quote,
          buttonLabel,
          book: (quoteToken, paymentMethodId) =>
            bookRide(
              {
                quoteToken,
                driverId,
                paymentMethodId,
                originAddress,
                destinationAddress,
              },
              getToken,
            ),
          requote: () => fetchQuote(pickup, dropoff, quote.scheduledAt),
          onBooked: (id) => {
            attempt.rideId = id;
          },
          onOutcomeUnknown: (id) => {
            attempt.outcomeUnknown = true;
            setUnknown({ rideId: id });
          },
          onPriceChanged: requestQuote,
          onSlotExpired: () => {
            attempt.slotExpired = true;
          },
        }),
      },
    });
    if (initError) {
      // R75: say why, instead of the sheet's generic "not initialised".
      Alert.alert(
        "Payment unavailable",
        initError.localizedMessage ?? initError.message,
      );
      setBusy(false);
      return;
    }

    const { error } = await presentPaymentSheet();
    if (attempt.slotExpired) {
      // K6: once the sheet is closed, back to the picker (Book Ride follows the notice).
      setBusy(false);
      expireSlot(SLOT_EXPIRED_NOTICE);
      return;
    }
    if (attempt.rideId !== null) {
      await (error ? settle(attempt.rideId, error) : finish(attempt.rideId));
      return;
    }
    // Nothing was booked. Canceled (P5) says nothing; P8 has its own view.
    if (error && error.code !== "Canceled" && !attempt.outcomeUnknown) {
      Alert.alert("Payment failed", error.localizedMessage ?? error.message);
    }
    setBusy(false);
  };

  const onPress = () => {
    setRequoteError(null);
    if (Date.now() - quote.issuedAtMs >= QUOTE_REFRESH_AFTER_MS) {
      awaitingFresh.current = quote.fareCents; // P3
      setBusy(true);
      requestQuote();
      return;
    }
    pay();
  };

  if (unknown) {
    // P8: never offer a second payment while the first one's outcome is unknown.
    return (
      <View testID="payment-unknown" className="my-10">
        <Text className="text-base font-JakartaSemiBold text-center">
          We couldn't confirm whether your payment went through.
        </Text>
        <CustomButton
          title="Check Rides"
          className="mt-4"
          onPress={() => {
            router.dismissAll();
            router.navigate("/(root)/(tabs)/rides");
          }}
        />
      </View>
    );
  }

  return (
    <View>
      {priceNotice && (
        <Text
          testID="payment-price-updated"
          className="text-base font-JakartaSemiBold text-warning-600 text-center mt-4"
        >
          {priceNotice}
        </Text>
      )}
      {requoteError && (
        <Text
          testID="payment-requote-error"
          className="text-base font-JakartaSemiBold text-danger-700 text-center mt-4"
        >
          {requoteError}
        </Text>
      )}
      <CustomButton
        testID="payment-confirm"
        title={buttonLabel}
        className="my-10"
        loading={busy}
        disabled={booked}
        onPress={onPress}
      />
    </View>
  );
};

/**
 * The Payment Sheet needs its provider; keeping it here lets Payment.web.tsx
 * stub it. Without a Stripe publishable key (or with a secret key pasted in
 * its place) there is no sheet to open: the button stays off and says which
 * key is missing, instead of failing at the first tap (EG5).
 */
const Payment = (props: PaymentProps) => {
  const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey || !isStripePublishableKey(publishableKey)) {
    return (
      <View testID="payment-not-set-up" className="my-10">
        <Text className="text-base font-JakartaSemiBold text-danger-700 text-center">
          {PAYMENTS_NOT_SET_UP}
        </Text>
        <CustomButton
          testID="payment-confirm"
          title={buttonLabelFor(props.quote)}
          className="mt-4"
          disabled
        />
      </View>
    );
  }
  return (
    <StripeProvider
      publishableKey={publishableKey}
      merchantIdentifier="merchant.com.djir"
      urlScheme="djir"
    >
      <PaymentButton {...props} />
    </StripeProvider>
  );
};

export default Payment;
