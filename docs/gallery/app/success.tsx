import BookRide from "@/app/(root)/book-ride";
import BookingSuccessModal from "@/components/BookingSuccessModal";

import { NOW, PICKUP_AT, seedBookingFlow, upcoming } from "../fixtures";
import { Shot } from "../Shot";

seedBookingFlow();

/**
 * The success modal over the real Book Ride screen, as after paying for
 * `upcoming` (on the web the Stripe sheet is a stub, so the gallery opens it).
 */
export default function Success() {
  return (
    <Shot>
      <BookRide />
      <BookingSuccessModal
        visible
        driverFirstName={upcoming.driver.first_name}
        scheduledAt={PICKUP_AT}
        nowMs={NOW}
        onOpenRide={() => {}}
        onBackHome={() => {}}
      />
    </Shot>
  );
}
