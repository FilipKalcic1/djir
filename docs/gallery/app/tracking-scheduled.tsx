import { NOW, upcoming } from "../fixtures";
import { TrackingShot } from "../Shot";

/** S4 at rest: Cancel ride is further down the sheet, below the fold. */
export default function TrackingScheduled() {
  return <TrackingShot ride={upcoming} nowMs={NOW} onCancel={() => {}} />;
}
