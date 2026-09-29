/**
 * services/clock.ts — the app's view of the server's clock.
 *
 * Pickup slots, ride phases and badges are decided by the server's time, so a
 * phone whose clock is a few minutes off must not offer slots the server will
 * refuse, or show a ride in the wrong phase. Every API response that carries
 * `server_time` updates the offset.
 */

let offsetMs = 0;

/** Record the server's time as of a response received at `receivedAtMs`. */
export function setServerTime(serverTime: string, receivedAtMs = Date.now()) {
  const serverMs = Date.parse(serverTime);
  if (Number.isFinite(serverMs)) offsetMs = serverMs - receivedAtMs;
}

/** Milliseconds to add to the device clock to get the server's. */
export const serverClockOffsetMs = () => offsetMs;

/** "Now" on the server's clock. */
export const serverNow = () => Date.now() + offsetMs;
