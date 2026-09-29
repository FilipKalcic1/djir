import { useEffect, useState } from "react";

/**
 * The current time (epoch ms), re-rendering every `intervalMs`, shifted by
 * `offsetMs` — the difference to the server's clock, so a phone whose clock is
 * a few minutes off still shows the right ride phase. A new `restartKey` (a
 * screen coming back into focus) reads the clock at once, not on the next tick.
 */
export function useNow(
  intervalMs = 30_000,
  offsetMs = 0,
  restartKey: unknown = null,
): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNow(Date.now() + offsetMs);
    const id = setInterval(() => setNow(Date.now() + offsetMs), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, offsetMs, restartKey]);
  return now;
}
