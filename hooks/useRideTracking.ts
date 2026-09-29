import { useEffect, useRef, useState } from "react";

import {
  PositionSource,
  straightLegs,
  TrackedRide,
  TrackingSnapshot,
} from "@/lib/tracking";

interface Options {
  /** Where the car is: the simulation today, a GPS feed tomorrow (ADR-010). */
  source: PositionSource;
  /** Epoch-ms clock (server-corrected). May be a new function every render. */
  now?: () => number;
  tickMs?: number;
}

/** The live tracking snapshot for `ride`, recomputed every `tickMs`. */
export function useRideTracking(
  ride: TrackedRide | null,
  { source, now = Date.now, tickMs = 1000 }: Options,
): TrackingSnapshot | null {
  const nowRef = useRef(now);
  nowRef.current = now;
  const [nowMs, setNowMs] = useState(() => now());

  useEffect(() => {
    setNowMs(nowRef.current());
    const id = setInterval(() => setNowMs(nowRef.current()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return ride ? source(ride, straightLegs(ride), nowMs) : null;
}
