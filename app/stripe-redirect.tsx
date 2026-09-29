import { router } from "expo-router";
import { useEffect } from "react";

/**
 * Stripe's 3-D Secure flow can return to the app via djir://stripe-redirect.
 * The Payment component hands that URL to Stripe; this route only makes sure
 * the rider lands back where they were, not on a "not found" screen.
 */
export default function StripeRedirect() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);
  return null;
}
