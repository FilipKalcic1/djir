/**
 * lib/zagreb-time.ts — the service clock.
 *
 * Djir prices and schedules rides on the Zagreb wall clock, whatever timezone
 * the phone or the API server happens to run in. Time-zone support in Hermes'
 * `Intl` differs between platforms, so instead of relying on it this module
 * implements the one rule Zagreb follows — EU summer time: CEST (UTC+2) from
 * the last Sunday of March to the last Sunday of October, switching at 01:00
 * UTC; CET (UTC+1) otherwise — with plain UTC arithmetic.
 *
 * __tests__/lib/zagreb-time.test.ts pins the DST boundaries and compares this
 * module with the IANA tz database (Node's `Intl`, "Europe/Zagreb") at every
 * hour from 2020 to 2035.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Wall-clock fields in Europe/Zagreb. `dayOfWeek` follows Python: Mon=0 … Sun=6. */
export interface ZagrebClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

function lastSundayAt0100Utc(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return Date.UTC(
    year,
    monthIndex,
    lastDay.getUTCDate() - lastDay.getUTCDay(),
    1,
  );
}

/** Zagreb's UTC offset at an instant, in minutes: 120 in summer (CEST), 60 otherwise (CET). */
export function zagrebOffsetMinutes(atMs: number): 60 | 120 {
  const year = new Date(atMs).getUTCFullYear();
  const isSummer =
    atMs >= lastSundayAt0100Utc(year, 2) && atMs < lastSundayAt0100Utc(year, 9);
  return isSummer ? 120 : 60;
}

/** The Zagreb wall clock at an instant. */
export function zagrebClock(at: Date | number): ZagrebClock {
  const atMs = typeof at === "number" ? at : at.getTime();
  const local = new Date(atMs + zagrebOffsetMinutes(atMs) * MS_PER_MINUTE);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    dayOfWeek: (local.getUTCDay() + 6) % 7,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "23:30" */
export function formatZagrebTime(atMs: number): string {
  const { hour, minute } = zagrebClock(atMs);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** "Sat 4 Oct" */
export function formatZagrebDate(atMs: number): string {
  const { day, month, dayOfWeek } = zagrebClock(atMs);
  return `${WEEKDAYS[dayOfWeek]} ${day} ${MONTHS[month - 1]}`;
}

/** "2026-10-04": the Zagreb calendar day an instant falls on. */
export function zagrebDayKey(atMs: number): string {
  const { year, month, day } = zagrebClock(atMs);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * The Zagreb calendar day after the one `atMs` falls on — by date, not by
 * adding 24 hours (days around a DST switch are 23 or 25 hours long).
 */
export function nextZagrebDayKey(atMs: number): string {
  const { year, month, day } = zagrebClock(atMs);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** "3 Oct 2026, 23:30" — or "25 Oct 2026, 02:15 CET" in the repeated hour (K12). */
export function formatZagrebDateTime(atMs: number): string {
  const { day, month, year } = zagrebClock(atMs);
  return `${day} ${MONTHS[month - 1]} ${year}, ${formatPickupTime(atMs)}`;
}

/** "CEST" in summer, "CET" in winter. */
export function zagrebZoneName(atMs: number): "CET" | "CEST" {
  return zagrebOffsetMinutes(atMs) === 120 ? "CEST" : "CET";
}

/**
 * Whether `atMs` falls in the hour the autumn fall-back repeats: 02:00–02:59
 * happens once in CEST and again in CET, so "02:15" alone names two instants.
 */
function inRepeatedHour(atMs: number): boolean {
  const fallBackMs = lastSundayAt0100Utc(new Date(atMs).getUTCFullYear(), 9);
  return atMs >= fallBackMs - MS_PER_HOUR && atMs < fallBackMs + MS_PER_HOUR;
}

/**
 * A pickup-related clock time: "08:00", or "02:15 CEST" / "02:15 CET" in the
 * repeated autumn hour, so every surface after the picker keeps the zone the
 * rider chose (K12).
 */
export function formatPickupTime(atMs: number): string {
  const time = formatZagrebTime(atMs);
  return inRepeatedHour(atMs) ? `${time} ${zagrebZoneName(atMs)}` : time;
}
