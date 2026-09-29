import { ARRIVED_AT, live } from "../fixtures";
import { TrackingShot } from "../Shot";

export default function TrackingArrived() {
  return <TrackingShot ride={live} nowMs={ARRIVED_AT} />;
}
