import { live, ON_TRIP_AT } from "../fixtures";
import { TrackingShot } from "../Shot";

export default function TrackingOnTrip() {
  return <TrackingShot ride={live} nowMs={ON_TRIP_AT} />;
}
