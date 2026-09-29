import {
  formatPickupTime,
  formatZagrebDate,
  formatZagrebTime,
  zagrebClock,
  zagrebDayKey,
  zagrebOffsetMinutes,
  formatZagrebDateTime,
  zagrebZoneName,
} from "@/lib/zagreb-time";

const at = (iso: string) => Date.parse(iso);

describe("zagrebOffsetMinutes — EU summer time", () => {
  it.each([
    // Spring forward: last Sunday of March, 01:00 UTC (02:00 CET → 03:00 CEST)
    ["2026-03-29T00:59:59Z", 60],
    ["2026-03-29T01:00:00Z", 120],
    // Fall back: last Sunday of October, 01:00 UTC (03:00 CEST → 02:00 CET)
    ["2026-10-25T00:59:59Z", 120],
    ["2026-10-25T01:00:00Z", 60],
    // Years where the last Sunday is the 31st and the 25th
    ["2024-03-31T01:00:00Z", 120],
    ["2027-03-28T00:30:00Z", 60],
    ["2027-10-31T00:30:00Z", 120],
    // Deep winter and summer
    ["2026-01-15T12:00:00Z", 60],
    ["2026-07-15T12:00:00Z", 120],
  ])("%s → UTC+%i min", (iso, offset) => {
    expect(zagrebOffsetMinutes(at(iso))).toBe(offset);
  });
});

describe("zagrebClock", () => {
  it("reads the wall clock in Zagreb, not on the device", () => {
    // The whole suite runs in America/Los_Angeles (jest.setup.ts).
    expect(new Date(at("2025-06-03T06:15:00Z")).getHours()).toBe(23);
    expect(zagrebClock(at("2025-06-03T06:15:00Z"))).toEqual({
      year: 2025,
      month: 6,
      day: 3,
      hour: 8,
      minute: 15,
      dayOfWeek: 1, // Tuesday (Mon = 0)
    });
  });

  it("rolls the calendar day over at Zagreb midnight", () => {
    const beforeMidnight = zagrebClock(at("2025-06-06T21:59:00Z"));
    const afterMidnight = zagrebClock(at("2025-06-06T22:00:00Z"));
    expect([beforeMidnight.dayOfWeek, beforeMidnight.hour]).toEqual([4, 23]);
    expect([afterMidnight.dayOfWeek, afterMidnight.hour]).toEqual([5, 0]);
  });

  it("repeats 02:xx on the fall-back night and skips it in spring", () => {
    expect(zagrebClock(at("2026-10-25T00:30:00Z")).hour).toBe(2);
    expect(zagrebClock(at("2026-10-25T01:30:00Z")).hour).toBe(2);
    expect(zagrebClock(at("2026-03-29T00:59:00Z")).hour).toBe(1);
    expect(zagrebClock(at("2026-03-29T01:00:00Z")).hour).toBe(3);
  });

  it("accepts a Date as well as epoch milliseconds", () => {
    const iso = "2026-12-24T18:45:00Z";
    expect(zagrebClock(new Date(iso))).toEqual(zagrebClock(at(iso)));
  });
});

describe("formatting", () => {
  const saturdayNight = at("2026-10-03T21:30:00Z"); // Sat 3 Oct, 23:30 CEST

  it("formats the time as HH:MM", () => {
    expect(formatZagrebTime(saturdayNight)).toBe("23:30");
    expect(formatZagrebTime(at("2026-01-05T07:05:00Z"))).toBe("08:05");
  });

  it("formats the date as 'Sat 3 Oct'", () => {
    expect(formatZagrebDate(saturdayNight)).toBe("Sat 3 Oct");
  });

  it("keys the Zagreb calendar day, which differs from the UTC day here", () => {
    expect(zagrebDayKey(at("2026-10-03T22:30:00Z"))).toBe("2026-10-04");
  });
});

describe("the tz-database oracle", () => {
  // Node's Intl carries the IANA tz database. If the EU ever abolishes DST,
  // this fails and tells us to update the rule above.
  const intl = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zagreb",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });

  it("agrees with Intl('Europe/Zagreb') every hour from 2020 to 2035", () => {
    const mismatches: string[] = [];
    const end = Date.UTC(2036, 0, 1);
    for (let t = Date.UTC(2020, 0, 1); t < end; t += 3_600_000) {
      const parts = Object.fromEntries(
        intl.formatToParts(t).map((p) => [p.type, Number(p.value)]),
      );
      const c = zagrebClock(t);
      if (
        c.year !== parts.year ||
        c.month !== parts.month ||
        c.day !== parts.day ||
        c.hour !== parts.hour ||
        c.minute !== parts.minute
      ) {
        mismatches.push(new Date(t).toISOString());
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("formatZagrebDateTime / zagrebZoneName", () => {
  it("formats a pickup like the ride history does", () => {
    expect(formatZagrebDateTime(Date.parse("2026-10-03T21:30:00Z"))).toBe(
      "3 Oct 2026, 23:30",
    );
  });

  it("names the zone in force", () => {
    expect(zagrebZoneName(Date.parse("2026-10-25T00:30:00Z"))).toBe("CEST");
    expect(zagrebZoneName(Date.parse("2026-10-25T01:30:00Z"))).toBe("CET");
  });
});

describe("formatPickupTime — the repeated autumn hour (K12)", () => {
  it.each([
    ["2026-10-24T23:59:00Z", "01:59"], // the hour before: unambiguous
    ["2026-10-25T00:00:00Z", "02:00 CEST"], // first pass of 02:xx
    ["2026-10-25T00:15:00Z", "02:15 CEST"],
    ["2026-10-25T00:59:59Z", "02:59 CEST"],
    ["2026-10-25T01:00:00Z", "02:00 CET"], // the clocks went back
    ["2026-10-25T01:15:00Z", "02:15 CET"],
    ["2026-10-25T01:59:59Z", "02:59 CET"],
    ["2026-10-25T02:00:00Z", "03:00"], // the hour after: unambiguous
    ["2027-10-31T00:30:00Z", "02:30 CEST"], // 2027's last Sunday of October
    ["2027-10-31T01:30:00Z", "02:30 CET"],
    ["2026-03-29T01:00:00Z", "03:00"], // spring forward repeats nothing
    ["2026-10-04T06:00:00Z", "08:00"],
  ])("K12: %s reads %p", (iso, text) => {
    expect(formatPickupTime(at(iso))).toBe(text);
  });

  it("K12: the history date keeps the zone too", () => {
    expect(formatZagrebDateTime(at("2026-10-25T01:15:00Z"))).toBe(
      "25 Oct 2026, 02:15 CET",
    );
    expect(formatZagrebDateTime(at("2026-10-25T00:15:00Z"))).toBe(
      "25 Oct 2026, 02:15 CEST",
    );
  });
});
