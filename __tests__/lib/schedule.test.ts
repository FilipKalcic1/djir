import {
  checkSlot,
  dayLabel,
  describePickup,
  earliestSlot,
  pickupSentence,
  resnapSlot,
  scheduleDays,
  scheduleError,
} from "@/lib/schedule";

import { MIN } from "../helpers/rides";

const at = (iso: string) => Date.parse(iso);

describe("earliestSlot", () => {
  it("K1: is the first 15-minute instant at least 30 minutes away", () => {
    expect(earliestSlot(at("2026-10-01T10:01:00Z"))).toBe(
      at("2026-10-01T10:45:00Z"),
    );
  });

  it("K1: includes a slot exactly 30 minutes away", () => {
    expect(earliestSlot(at("2026-10-01T10:00:00Z"))).toBe(
      at("2026-10-01T10:30:00Z"),
    );
  });
});

describe("scheduleDays", () => {
  // Wed 30 Sep 2026, 08:00 in Zagreb (06:00Z).
  const now = at("2026-09-30T06:00:00Z");
  const days = scheduleDays(now);

  it("K1: starts today, 30 minutes out, labelled on the Zagreb clock", () => {
    expect(days[0].label).toBe("Today");
    expect(days[0].slots[0]).toEqual({
      atMs: at("2026-09-30T06:30:00Z"),
      label: "08:30",
    });
  });

  it("labels the following days 'Tomorrow', then by date", () => {
    expect(days.slice(1, 3).map((d) => d.label)).toEqual([
      "Tomorrow",
      "Fri 2 Oct",
    ]);
  });

  it("K3: offers every slot up to (not including) 168 hours ahead", () => {
    const all = days.flatMap((d) => d.slots);
    expect(all).toHaveLength(7 * 96 - 2); // 08:00 + 30 min lead → 2 slots fewer
    expect(all[all.length - 1].atMs).toBe(now + 168 * 60 * MIN - 15 * MIN);
  });

  it("K2: has 96 slots on a normal full day", () => {
    expect(days[1].slots).toHaveLength(96);
    expect(days[1].slots[0].label).toBe("00:00");
    expect(days[1].slots[95].label).toBe("23:45");
  });

  it("K2: has 92 slots on the spring-forward day, with no 02:xx", () => {
    const spring = scheduleDays(at("2026-03-27T12:00:00Z")).find(
      (d) => d.key === "2026-03-29",
    )!;
    expect(spring.slots).toHaveLength(92);
    expect(spring.slots.map((s) => s.label)).not.toContain("02:15");
    expect(spring.slots[8].label).toBe("03:00");
  });

  it("K2: has 100 slots on the fall-back day and names the repeated hour's zone", () => {
    const autumn = scheduleDays(at("2026-10-23T12:00:00Z")).find(
      (d) => d.key === "2026-10-25",
    )!;
    const labels = autumn.slots.map((s) => s.label);
    expect(autumn.slots).toHaveLength(100);
    expect(labels).toContain("02:15 CEST");
    expect(labels).toContain("02:15 CET");
    expect(labels.indexOf("02:15 CEST")).toBeLessThan(
      labels.indexOf("02:15 CET"),
    );
    expect(labels).toContain("01:15"); // unambiguous hours stay plain
  });

  it("K12: a lone slot of the repeated hour keeps its zone once the first pass is inside the lead", () => {
    // 02:05 CEST: of the first 02:xx pass only 02:45 CEST is still bookable.
    const [today] = scheduleDays(at("2026-10-25T00:05:00Z"));
    expect(today.slots.slice(0, 6).map((s) => s.label)).toEqual([
      "02:45 CEST",
      "02:00 CET",
      "02:15 CET",
      "02:30 CET",
      "02:45 CET",
      "03:00",
    ]);
  });

  it("starts with 'Tomorrow' late at night", () => {
    expect(scheduleDays(at("2026-09-30T21:50:00Z"))[0].label).toBe("Tomorrow");
  });
});

describe("resnapSlot", () => {
  const now = at("2026-09-30T06:00:00Z");

  it("keeps a slot that is still valid", () => {
    expect(resnapSlot(at("2026-09-30T09:00:00Z"), now)).toBe(
      at("2026-09-30T09:00:00Z"),
    );
  });

  it("moves a slot that went stale to the earliest valid one", () => {
    expect(resnapSlot(at("2026-09-30T06:15:00Z"), now)).toBe(
      at("2026-09-30T06:30:00Z"),
    );
  });
});

describe("scheduleError (server-side check)", () => {
  const now = at("2026-09-30T06:00:00Z");

  it.each([
    ["25 min ahead (inside the 5 min grace)", now + 25 * MIN, null],
    ["24 min ahead", now + 24 * MIN, "That pickup time is no longer available"],
    ["in the past", now - MIN, "That pickup time is no longer available"],
    ["exactly 168 h ahead", now + 168 * 60 * MIN, null],
    [
      "168 h + 15 min ahead",
      now + (168 * 60 + 15) * MIN,
      "Rides can be scheduled up to 7 days ahead",
    ],
  ])("K13: %s → %p", (_, atMs, expected) => {
    expect(scheduleError(atMs, now)).toBe(expected);
  });
});

describe("describePickup", () => {
  const now = at("2026-09-30T06:00:00Z");

  it.each([
    [null, "Now"],
    [at("2026-09-30T21:30:00Z"), "Today · 23:30"],
    [at("2026-10-01T06:00:00Z"), "Tomorrow · 08:00"],
    [at("2026-10-03T21:30:00Z"), "Sat 3 Oct · 23:30"],
  ])("%p → %s", (scheduledAt, text) => {
    expect(describePickup(scheduledAt, now)).toBe(text);
  });
});

describe("describePickup / pickupSentence in the repeated autumn hour (K12)", () => {
  const now = at("2026-10-24T06:00:00Z"); // Sat 24 Oct, 08:00 CEST

  it.each([
    [
      at("2026-10-25T00:15:00Z"),
      "Tomorrow · 02:15 CEST",
      "tomorrow at 02:15 CEST",
    ],
    [
      at("2026-10-25T01:15:00Z"),
      "Tomorrow · 02:15 CET",
      "tomorrow at 02:15 CET",
    ],
    [at("2026-10-25T02:15:00Z"), "Tomorrow · 03:15", "tomorrow at 03:15"],
  ])("K12: %p → %s / %s", (atMs, described, sentence) => {
    expect(describePickup(atMs, now)).toBe(described);
    expect(pickupSentence(atMs, now)).toBe(sentence);
  });
});

describe("dayLabel around DST switches (K9)", () => {
  it.each([
    // 28 Mar 2026 23:30 CET: the next calendar day (29 Mar) is only 23 h long.
    ["2026-03-28T22:30:00Z", "2026-03-29T08:00:00Z", "Tomorrow"],
    ["2026-03-28T22:30:00Z", "2026-03-30T08:00:00Z", "Mon 30 Mar"],
    // 25 Oct 2026 00:30 CEST: today is 25 h long; now + 24 h is still "today".
    ["2026-10-24T22:30:00Z", "2026-10-26T07:00:00Z", "Tomorrow"],
    ["2026-10-24T22:30:00Z", "2026-10-25T20:00:00Z", "Today"],
  ])("K9: at %s, %s is %s", (now, at, label) => {
    expect(dayLabel(Date.parse(at), Date.parse(now))).toBe(label);
  });
});

describe('pickupSentence (the "Ride scheduled" modal)', () => {
  const now = at("2026-09-30T06:00:00Z");

  it.each([
    [at("2026-09-30T21:30:00Z"), "today at 23:30"],
    [at("2026-10-01T06:00:00Z"), "tomorrow at 08:00"],
    [at("2026-10-03T06:00:00Z"), "on Sat 3 Oct at 08:00"],
  ])("%p → %s", (atMs, sentence) => {
    expect(pickupSentence(atMs, now)).toBe(sentence);
  });
});

describe("checkSlot — a chosen time that went stale while the rider decided", () => {
  // At 08:00 in Zagreb (06:00Z) the rider chose 08:30, then the first slot (K1).
  const chosen = at("2026-09-30T06:30:00Z");

  it("keeps a ride now as it is", () => {
    expect(checkSlot(null, at("2026-09-30T06:00:00Z"))).toEqual({
      status: "ok",
      atMs: null,
    });
  });

  it("K1: keeps a slot that is still at least 30 minutes away", () => {
    expect(checkSlot(chosen, at("2026-09-30T06:00:00Z"))).toEqual({
      status: "ok",
      atMs: chosen,
    });
  });

  it.each([
    ["08:00:01", "2026-09-30T06:00:01Z"],
    ["08:05", "2026-09-30T06:05:00Z"],
    ["08:14:59.999", "2026-09-30T06:14:59.999Z"],
  ])(
    "K4: at %s (stale for less than 15 min) it moves to 08:45 with a notice",
    (_, now) => {
      expect(checkSlot(chosen, at(now))).toEqual({
        status: "moved",
        atMs: at("2026-09-30T06:45:00Z"),
        notice: "That time is now too soon — moved to 08:45",
      });
    },
  );

  it("K4 K12: a slot moved into the repeated hour names its zone", () => {
    // 02:25 CEST; the rider's 02:45 CEST went stale 10 min ago.
    expect(
      checkSlot(at("2026-10-25T00:45:00Z"), at("2026-10-25T00:25:00Z")),
    ).toEqual({
      status: "moved",
      atMs: at("2026-10-25T01:00:00Z"),
      notice: "That time is now too soon — moved to 02:00 CET",
    });
  });

  it.each([
    ["08:15 (stale for exactly 15 min)", "2026-09-30T06:15:00Z"],
    ["08:40 (the pickup time itself has passed)", "2026-09-30T06:40:00Z"],
  ])("K5: at %s it is dropped and the rider picks again", (_, now) => {
    expect(checkSlot(chosen, at(now))).toEqual({
      status: "expired",
      notice: "That pickup time is no longer available — choose a new time",
    });
  });
});
