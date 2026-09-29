import CustomButton from "@/components/CustomButton";

import type { PaymentProps } from "@/components/Payment";

/** Web build stub: the Stripe Payment Sheet is native-only (R70). */
const Payment = (_: PaymentProps) => (
  <CustomButton
    title="Payments are available in the iOS and Android app"
    className="my-10"
    disabled
  />
);

export default Payment;
