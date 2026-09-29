import FindRide from "@/app/(root)/find-ride";
import ScheduleModal from "@/components/ScheduleModal";

import { NOW, PICKUP_AT, seedBookingFlow } from "../fixtures";
import { Shot } from "../Shot";

seedBookingFlow();

/** The pickup-time picker, open over the real Find ride screen. */
export default function Schedule() {
  return (
    <Shot>
      <FindRide />
      <ScheduleModal
        visible
        nowMs={NOW}
        value={PICKUP_AT}
        onConfirm={() => {}}
        onClose={() => {}}
      />
    </Shot>
  );
}
