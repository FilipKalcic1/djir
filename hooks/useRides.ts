import { useAuth } from "@clerk/clerk-expo";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFetch } from "@/hooks/useFetch";
import { useNow } from "@/hooks/useNow";
import { desiredReminders } from "@/lib/reminders";
import { sortRidesForHistory } from "@/lib/rides";
import { trackingSpeedup } from "@/lib/tracking";
import { LOAD_TIMEOUT_MS } from "@/services/api";
import { serverClockOffsetMs, setServerTime } from "@/services/clock";
import { syncReminders } from "@/services/reminders";
import { Ride } from "@/types/type";

/** The demo speed-up for simulated rides (development builds only). */
export const SPEEDUP = trackingSpeedup(
  process.env.EXPO_PUBLIC_TRACKING_SPEEDUP,
  typeof __DEV__ !== "undefined" && __DEV__,
);

/**
 * How often the history's clock ticks: every 30 s, or every 250 ms under a
 * demo speed-up, where each real 3 s is a simulated minute — so the Home
 * banner's lines follow the tracker's (B1a, B1d, B1b), as the tracker's own
 * clock does.
 */
export const HISTORY_TICK_MS = SPEEDUP > 1 ? 250 : 30_000;

/**
 * The signed-in rider's history in display order (Live, Upcoming, the rest).
 *
 *  - refetches whenever its screen comes back into focus, so a ride booked or
 *    cancelled a moment ago shows up without a pull (H6/H7), and reads the
 *    clock again at once;
 *  - re-ticks a server-corrected clock every `tickMs`, so a badge flips from
 *    Upcoming to Live without a refetch;
 *  - gives up on a load with no answer after LOAD_TIMEOUT_MS, so the screen
 *    shows its error state (H10, S2) instead of a spinner for good;
 *  - keeps the ride reminders in step with the history (N7).
 */
export function useRides({ tickMs = HISTORY_TICK_MS } = {}) {
  const { userId } = useAuth();
  const { body, loading, error, refetch } = useFetch<
    Ride[],
    { data: Ride[]; server_time: string }
  >(userId ? "/(api)/rides" : null, {
    authenticated: true,
    timeoutMs: LOAD_TIMEOUT_MS,
  });

  // useFetch already loads on mount and whenever the url changes (a new
  // `refetch`): only a screen coming back into focus needs another request.
  const focusedWith = useRef<typeof refetch | null>(null);
  const [focusCount, setFocusCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (focusedWith.current === refetch) {
        refetch();
        setFocusCount((n) => n + 1); // the clock, too, is read on return
      }
      focusedWith.current = refetch;
    }, [refetch]),
  );

  // Kept in state, set with the server time, so no render reads a stale offset.
  // It starts from the offset an earlier response taught the app, so even the
  // renders before this history arrives read the server's clock (T4).
  const [clockOffsetMs, setClockOffsetMs] = useState(serverClockOffsetMs);
  useEffect(() => {
    if (!body) return;
    setServerTime(body.server_time);
    setClockOffsetMs(serverClockOffsetMs());
    syncReminders(
      desiredReminders(body.data, Date.parse(body.server_time)),
    ).catch((err) => console.warn("Could not update ride reminders:", err));
  }, [body]);

  const nowMs = useNow(tickMs, clockOffsetMs, focusCount);
  const rides = useMemo(
    () => sortRidesForHistory(body?.data ?? [], nowMs, SPEEDUP),
    [body, nowMs],
  );

  return { rides, loading, error, refetch, nowMs, clockOffsetMs };
}
