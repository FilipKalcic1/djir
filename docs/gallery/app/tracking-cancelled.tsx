import { cancelled, NOW } from "../fixtures";
import { TrackingShot } from "../Shot";

export default function TrackingCancelled() {
  return <TrackingShot ride={cancelled} nowMs={NOW} />;
}
