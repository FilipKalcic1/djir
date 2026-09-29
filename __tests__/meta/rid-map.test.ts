/**
 * The plan's checklists and the suite prove each other (plan §2 C1–C4, §8
 * "Tests"). A row is proven only by an `it`/`test` title that starts with its
 * ID (helpers/plan.ts says exactly how `.each` titles count):
 * - an Appendix A TEST row, in every test file its Proof cell cites, and by
 *   every pytest function it cites;
 * - a §4/§6 row with testIDs, by components/ or screens/ tests titled with it
 *   whose own code uses each testID (C1, C4);
 * - any other §4/§6 row, in any test file outside __tests__/meta;
 * - a row with its own Proof column (WP6 D1–D4), where that column says.
 * Every QA cell names §12 steps whose Expected cell names the row, or `auto`;
 * every J step of §2 maps to a test title or a §12 step; the §8 examples are
 * copied from the code they name; the §9 coverage table is jest.config.js's
 * thresholds. The §10 verdicts follow from Appendix A and §12, the frozen
 * rows hash to the value the latest plan pass records, and the finding ledger
 * (Appendix D) gives every graded finding one checked disposition, from which
 * §0's latest grade follows.
 */
import { createHash } from "crypto";

import {
  citedPytest,
  citedTests,
  IS_ROW_ID,
  jestTitles,
  namesId,
  provenIn,
  pytestFunctions,
  pytestMatching,
  pytestRidsOf,
  qaCell,
  qaExpected,
  qaSteps,
  read,
  resolveTitle,
  section,
  Table,
  tables,
  testFile,
  Title,
  titlesIn,
  withHelpers,
} from "../helpers/plan";

const plan = read("docs/BUILD_PLAN.md");
/** The plan without the finding ledger, which quotes other sections' text. */
const body = plan.slice(0, plan.indexOf("\n## Appendix D"));
const titles = jestTitles();
const outsideMeta = titles.filter(
  ({ file }) => !file.startsWith("__tests__/meta/"),
);
const proven = provenIn(titles);
const provenOutsideMeta = provenIn(outsideMeta);
const pytest = pytestFunctions();
const steps = qaSteps(plan);
const expectedOf = qaExpected(plan);
const scripts = JSON.parse(read("package.json")).scripts as Record<
  string,
  string
>;

const idsOf = (source: string, file = "__tests__/x.test.tsx") =>
  titlesIn(file, source).map(({ kind, ids }) => ({ kind, ids }));

describe("how a title proves a row (helpers/plan.ts)", () => {
  it.each([
    ['it("T3: x", () => {});', ["T3"]],
    ['test("R04 R08: x", () => {});', ["R04", "R08"]],
    ['it("MP2/MP3, B1a: x", () => {});', ["MP2", "MP3", "B1a"]],
    ['it("formatMinutes (R41) rounds up", () => {});', []],
    ['it("lists the removed ones (R03, R37): x", () => {});', []],
    ['it("keeps T3: x", () => {});', []],
    ["it(`${id}: x`, () => {});", []],
    ['it.each([["S5", 1], ["S6", 2]])("%s: x %p", () => {});', ["S5", "S6"]],
    ['it.each([["S5", 1]] as const)("%s: x", () => {});', ["S5"]],
    ['it.each(["H1 H2", "B3"])("%s: x", () => {});', ["H1", "H2", "B3"]],
    ['it.each([["Track", "R01"]])("R74 %s: x %s", () => {});', ["R74"]],
    [
      'it.each([{ row: "H1" }, { row: "H2" }])("$row: x", () => {});',
      ["H1", "H2"],
    ],
    ['it.each([["R35: bad JSON", 400]])("%s → %i", () => {});', ["R35"]],
    ['it.each([[1, "S5"]])("%i %s: x", () => {});', []],
    ['it.each(ROWS)("%s: x", () => {});', []],
    ['it.each(ROWS)("R01 %s: x", () => {});', ["R01"]],
    ['it.each([["S5"]])("the %s phase: x", () => {});', []],
    ['it.each([["S5"]])("%p: x", () => {});', []],
    ['it("P4 Android: x", () => {});', ["P4"]],
    ['it("T3 and T4", () => {});', []],
  ])("reads %s as naming %j", (source, ids) => {
    expect(idsOf(source)).toEqual([{ kind: expect.any(String), ids }]);
  });

  it("never credits a describe title", () => {
    const source = 'describe("T3: x", () => { it("T4: y", () => {}); });';

    expect([...provenIn(titlesIn("__tests__/x.test.ts", source))]).toEqual([
      ["T4", new Set(["__tests__/x.test.ts"])],
    ]);
  });

  it("reads indented tables, drops the divider and splits on unescaped pipes only", () => {
    const markdown = [
      "  | ID | Check |",
      "  | --- | --- |",
      "  | D1 | `app/(root\\|auth)/**` |",
      "",
      "| A |",
      "| --- |",
    ].join("\n");

    expect(tables(markdown)).toEqual([
      { header: ["ID", "Check"], rows: [["D1", "`app/(root\\|auth)/**`"]] },
      { header: ["A"], rows: [] },
    ]);
  });

  it.each([
    ["9a / 12", ["9a", "12"]],
    ["auto", []],
    ["10a, 10b", ["10a", "10b"]],
    ["8 (offline)", null],
    ["99", null],
    ["", null],
  ])("reads the QA cell %p as %j", (cell, expected) => {
    expect(qaCell(cell, ["8", "9a", "10a", "10b", "12"])).toEqual(expected);
  });

  it("gives a test's source its callback, its .each table and the file-level helpers it calls, transitively — nothing else", () => {
    const source = [
      'const cardId = "driver-card-1";',
      "const card = () => screen.getByTestId(cardId);",
      'const unused = () => screen.getByTestId("elsewhere");',
      'it.each([["S5"]])("%s: x", () => { expect(card()).toBeTruthy(); });',
      'describe("S6: y", () => {});',
    ].join("\n");

    const [each, describe] = titlesIn("__tests__/x.test.tsx", source);

    expect(each.source).toContain('"driver-card-1"');
    expect(each.source).toContain('[["S5"]]');
    expect(each.source).not.toContain("elsewhere");
    expect(describe.source).toBe("");
    expect(withHelpers("b()", new Map([["a", "never read"]]))).toBe("b()");
  });

  it("names a row only as a whole token", () => {
    expect(namesId("the banner lines (B1a, B1d)", "B1a")).toBe(true);
    expect(namesId("the banner lines (B1a, B1d)", "B1")).toBe(false);
    expect(namesId("(PP-12, part a)", "PP-12")).toBe(true);
    expect(namesId("PP-12", "PP-1")).toBe(false);
    expect(namesId("`WP0-CI-never-run`", "WP0")).toBe(false);
  });
});

/** Appendix A's R-id rows: R · WP · Type · Proof · Status. */
const appendixA = tables(section(plan, "## Appendix A")).find(
  ({ header }) => header[0] === "R",
)!;
const ridRows = appendixA.rows.filter((cells) => /^R\d{2}$/.test(cells[0]));

/** Whether a CMD part holds: an exact command → its output, or a test title that exists. */
function cmdPartHolds(part: string, allTitles: Title[]): boolean {
  if (/^`[^`]+` → \S/.test(part)) return true;
  const test = /^`([^`]+ › [^`]+)`/.exec(part);
  return test !== null && resolveTitle(test[1], allTitles) !== undefined;
}

describe("Appendix A: every finding has an owner, a proof and a status", () => {
  const ofType = (type: string) =>
    ridRows
      .filter((cells) => cells[2] === type)
      .map((cells) => [cells[0], cells[3]]);

  it("has the columns R · WP · Type · Proof · Status", () => {
    expect(appendixA.header).toEqual(["R", "WP", "Type", "Proof", "Status"]);
  });

  it("lists R01–R77 exactly once each", () => {
    expect(ridRows.map((cells) => cells[0])).toEqual(
      Array.from(
        { length: 77 },
        (_, i) => `R${String(i + 1).padStart(2, "0")}`,
      ),
    );
  });

  it.each(ridRows.map((cells) => [cells[0], cells[4]]))(
    "%s has a status: fixed in a logged pass, open with its item, or deferred to §11 — and a ❌ is never 'fixed' (%s)",
    (_, status) => {
      expect(status).toMatch(
        /^(fixed · (plan )?r\d+|open · `WP\d-[\w-]+`|deferred · §11)/,
      );
      expect(status.startsWith("fixed") && status.includes("❌")).toBe(false);
    },
  );

  it.each(ofType("TEST"))(
    "%s: every test file it cites has an it/test title starting with it, and every pytest function it cites is named for it (%s)",
    (id, proof) => {
      const files = citedTests(proof);
      const functions = citedPytest(proof);
      expect(files.length + functions.length).toBeGreaterThan(0);
      expect(
        files.map((ref) => ({
          ref,
          titled: proven.get(id)?.has(testFile(ref) ?? "") ?? false,
        })),
      ).toEqual(files.map((ref) => ({ ref, titled: true })));
      expect(
        functions.map((ref) => ({
          ref,
          named: pytestMatching(ref, pytest).some((name) =>
            pytestRidsOf(name).includes(id),
          ),
        })),
      ).toEqual(functions.map((ref) => ({ ref, named: true })));
    },
  );

  it("reads a CMD part as a command → its output, or as a test title that exists", () => {
    expect(cmdPartHolds("`grep -c x f` → `0`", titles)).toBe(true);
    expect(
      cmdPartHolds(
        "`lib/rides › returns a new array and leaves the input alone`",
        titles,
      ),
    ).toBe(true);
    expect(cmdPartHolds("`lib/rides › returns a copy`", titles)).toBe(false);
    expect(cmdPartHolds("`grep -c x f`", titles)).toBe(false);
  });

  it.each(ofType("CMD"))(
    "%s: each part is an exact command and its expected output, run from the repo root, or a test title that exists (%s)",
    (_, proof) => {
      expect(
        proof.split(" · ").filter((part) => !cmdPartHolds(part, titles)),
      ).toEqual([]);
    },
  );

  it.each(ofType("DEF"))(
    "%s is deferred with no owner and cites no test (%s)",
    (id, proof) => {
      const row = ridRows.find((cells) => cells[0] === id)!;
      expect(row[1]).toBe("—");
      expect([...citedTests(proof), ...citedPytest(proof)]).toEqual([]);
    },
  );

  it("gives an owner to every finding that is not deferred", () => {
    expect(
      ridRows
        .filter((cells) => (cells[1] === "—") !== (cells[2] === "DEF"))
        .map((cells) => cells[0]),
    ).toEqual([]);
  });
});

type Row = {
  id: string;
  testIDs: string[] | null;
  qa: string | null;
  proof: string | null;
};

/** The rows of the §4 tables whose first column is an ID (R-ids excluded). */
function rowsOf(tablesInPlan: Table[]): Row[] {
  return tablesInPlan
    .filter(({ header }) => header[0] === "ID")
    .flatMap(({ header, rows }) => {
      const at = (name: string) => header.indexOf(name);
      let previous: string[] | null = null;
      return rows
        .filter(
          (cells) => IS_ROW_ID.test(cells[0]) && !/^R\d{2}$/.test(cells[0]),
        )
        .map((cells) => {
          let testIDs: string[] | null = null;
          if (at("testID") >= 0) {
            const cell = cells[at("testID")];
            testIDs =
              cell === "〃"
                ? previous
                : [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
            previous = testIDs;
          }
          return {
            id: cells[0],
            testIDs,
            qa: at("QA") >= 0 ? cells[at("QA")] : null,
            proof: at("Proof") >= 0 ? cells[at("Proof")] : null,
          };
        });
    });
}

/** What a testID cell's source must contain: `ride-card-{id}` → "ride-card-". */
const stem = (testID: string) => testID.split("{")[0];

/**
 * The test files that prove a §4/§6 row. Without testIDs: any test titled
 * with its ID outside __tests__/meta. With testIDs (C1, C4): components/ or
 * screens/ tests titled with its ID, where each testID is used by the own
 * code of at least one of them — not merely somewhere else in the file.
 */
function provenBy(
  { id, testIDs }: Pick<Row, "id" | "testIDs">,
  candidates: Title[] = outsideMeta,
): string[] {
  const titled = candidates.filter(
    ({ kind, ids }) => kind !== "describe" && ids.includes(id),
  );
  if (!testIDs?.length) return [...new Set(titled.map(({ file }) => file))];
  const rendered = titled.filter(({ file }) =>
    /^__tests__\/(components|screens)\//.test(file),
  );
  const users = testIDs.map((testID) =>
    rendered.filter(({ source }) => source.includes(stem(testID))),
  );
  return users.every((tests) => tests.length > 0)
    ? [...new Set(users.flat().map(({ file }) => file))]
    : [];
}

describe("how a row is proven (C1, C4)", () => {
  it("a row's testID must be used by the own code of a components/ or screens/ test titled with it", () => {
    expect(provenBy({ id: "S5", testIDs: ["tracking-headline"] })).toContain(
      "__tests__/components/TrackingSheet.test.tsx",
    );
    // T1 is titled only in lib/tracking: a pure test renders nothing.
    expect(provenBy({ id: "T1", testIDs: [] })).toEqual([
      "__tests__/lib/tracking.test.ts",
    ]);
    expect(provenBy({ id: "T1", testIDs: ["tracking-headline"] })).toEqual([]);
    expect(provenBy({ id: "W1", testIDs: ["when-row"] })).toEqual([]);
    expect(provenBy({ id: "H2", testIDs: ["ride-card-{id}"] })).toContain(
      "__tests__/components/RideCard.test.tsx",
    );
  });

  it("a testID used by another test in the same file proves nothing", () => {
    const file = "__tests__/components/X.test.tsx";
    const source = [
      'it("Q1: a", () => { render(<X />); });',
      'it("Q2: b", () => { screen.getByTestId("quotes-loading"); });',
    ].join("\n");

    expect(
      provenBy(
        { id: "Q1", testIDs: ["quotes-loading"] },
        titlesIn(file, source),
      ),
    ).toEqual([]);
    expect(
      provenBy(
        { id: "Q2", testIDs: ["quotes-loading"] },
        titlesIn(file, source),
      ),
    ).toEqual([file]);
  });
});

/** The row IDs of every table in `markdown` whose first cell is an ID. */
const tableIds = (markdown: string) =>
  tables(markdown)
    .flatMap(({ rows }) => rows.map((cells) => cells[0]))
    .filter((id) => IS_ROW_ID.test(id));

/** The rows a title may name: §2, §4 and §6 rows, and Appendix A's R-ids. */
const planRowIds = [
  ...tableIds(section(plan, "## 2. Definition of done")),
  ...tableIds(section(plan, "## 4. Work packages")),
  ...tableIds(section(plan, "## 6. Data model")),
  ...ridRows.map((cells) => cells[0]),
];
const known = new Set(planRowIds);

describe("§4 and §6: every state, edge and element row is proven", () => {
  const rows = rowsOf([
    ...tables(section(plan, "## 4. Work packages")),
    ...tables(section(plan, "## 6. Data model")),
  ]);
  const ids = rows.map(({ id }) => id);

  it("finds every table, indented ones included", () => {
    for (const id of [
      "PT1",
      "E1",
      "M9",
      "X8",
      "P1",
      "Q4",
      "T11",
      "S9",
      "X10",
      "F1",
      "MP4",
      "H10",
      "B4",
      "K9",
      "W1",
      "N7",
      "D4",
      "DB1",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("never lets a file under __tests__/meta prove a row here, though meta titles do carry IDs", () => {
    const inMeta = (files: Set<string>) =>
      [...files].filter((file) => file.startsWith("__tests__/meta/"));

    expect([...provenOutsideMeta.values()].flatMap(inMeta)).toEqual([]);
    expect([...proven.values()].flatMap(inMeta)).not.toEqual([]);
  });

  it("gives every row its own ID across §2, §4, §6 and Appendix A", () => {
    expect(planRowIds.filter((id, i) => planRowIds.indexOf(id) !== i)).toEqual(
      [],
    );
  });

  it.each(
    rows
      .filter(({ proof }) => proof === null)
      .map(({ id, testIDs }) =>
        testIDs?.length
          ? [
              id,
              `components/ or screens/ tests whose own code uses ${testIDs.join(", ")}`,
            ]
          : [id, "a test outside __tests__/meta"],
      ),
  )("%s: an it/test title starts with it in %s", (id) => {
    expect(provenBy(rows.find((r) => r.id === id)!)).not.toEqual([]);
  });

  it.each(
    rows
      .filter(({ proof }) => proof !== null)
      .map(({ id, proof }) => [id, proof]),
  )("%s: its Proof cell holds (%s)", (id, proof) => {
    const files = citedTests(proof!);
    const functions = citedPytest(proof!);
    const commands = [...proof!.matchAll(/`npm run ([\w:-]+)`/g)].map(
      (m) => m[1],
    );
    expect(files.length + functions.length + commands.length).toBeGreaterThan(
      0,
    );
    expect(
      files.filter((ref) => !proven.get(id)?.has(testFile(ref) ?? "")),
    ).toEqual([]);
    expect(
      functions.filter((ref) => pytestMatching(ref, pytest).length === 0),
    ).toEqual([]);
    expect(commands.filter((name) => !(name in scripts))).toEqual([]);
  });

  it.each(rows.filter(({ qa }) => qa !== null).map(({ id, qa }) => [id, qa]))(
    "%s: its QA cell %p is auto, or §12 steps whose Expected cell names the row (C1)",
    (id, qa) => {
      const named = qaCell(qa!, steps);
      expect(named).not.toBeNull();
      expect(
        named!.filter((step) => !namesId(expectedOf.get(step)!, id)),
      ).toEqual([]);
    },
  );

  it("every §12 step names a row or an R-id of the plan, so each step has an owner", () => {
    expect(
      steps.filter(
        (step) => ![...known].some((id) => namesId(expectedOf.get(step)!, id)),
      ),
    ).toEqual([]);
  });
});

describe("§2: every acceptance journey step maps to a test or a §12 step", () => {
  const journeys = tables(section(plan, "## 2. Definition of done")).find(
    ({ header }) => header.join(" | ") === "ID | Step | Tests | §12",
  ) ?? { header: [], rows: [] };

  it("finds J1 and J2", () => {
    expect(journeys.rows.map((cells) => cells[0])).toEqual(
      expect.arrayContaining(["J1a", "J1d", "J2a", "J2d"]),
    );
  });

  it.each(journeys.rows.map((cells) => [cells[0], cells[2], cells[3]]))(
    "%s: each title it cites exists (%s), and each §12 step of %p names it",
    (id, tests, qa) => {
      const refs = [...tests.matchAll(/`([^`]+ › [^`]+)`/g)].map((m) => m[1]);
      const named = qa === "—" ? [] : qaCell(qa, steps);
      expect(named).not.toBeNull();
      expect(refs.length + named!.length).toBeGreaterThan(0);
      expect(refs.filter((ref) => !resolveTitle(ref, titles))).toEqual([]);
      expect(
        named!.filter((step) => !namesId(expectedOf.get(step)!, id)),
      ).toEqual([]);
    },
  );
});

/**
 * The frozen checklist rows (§2): every ID row of §2, §4 and §6, Appendix A
 * without its Status column, and Appendix B.
 */
function frozenRows(markdown: string): string[] {
  const idRows = (text: string) =>
    tables(text)
      .flatMap(({ rows }) => rows)
      .filter((cells) => IS_ROW_ID.test(cells[0]))
      .map((cells) => cells.join(" | "));
  const appendixRows = tables(section(markdown, "## Appendix A"))
    .flatMap(({ rows }) => rows)
    .filter((cells) => /^R\d{2}$/.test(cells[0]))
    .map((cells) => cells.slice(0, 4).join(" | "));
  const claimRows = tables(section(markdown, "## Appendix B"))
    .flatMap(({ rows }) => rows)
    .filter((cells) => /^B\d+$/.test(cells[0]))
    .map((cells) => cells.join(" | "));
  return [
    ...idRows(section(markdown, "## 2. Definition of done")),
    ...idRows(section(markdown, "## 4. Work packages")),
    ...idRows(section(markdown, "## 6. Data model")),
    ...appendixRows,
    ...claimRows,
  ];
}

const checklistHash = (markdown: string) =>
  createHash("sha256")
    .update(frozenRows(markdown).join("\n"))
    .digest("hex")
    .slice(0, 12);

/** The §10 log's rows (Pass · Scope · Base · …). */
const logRows = tables(section(plan, "## 10. Iteration log")).find(
  ({ header }) => header[0] === "Pass",
)!.rows;

describe("§2: the frozen rows change only with a logged plan pass", () => {
  it("hashes every frozen row and nothing else: a Status cell may change, a row may not", () => {
    const status = plan.replace(
      /(\| R01 \| [^\n]*\| )fixed · r4 \|/,
      "$1fixed · r4 · ✅ 2099-01-01 |",
    );
    const row = plan.replace("| T1 | now = departAt", "| T1 | now ≈ departAt");

    expect(status).not.toBe(plan);
    expect(row).not.toBe(plan);
    expect(checklistHash(status)).toBe(checklistHash(plan));
    expect(checklistHash(row)).not.toBe(checklistHash(plan));
  });

  it("the frozen rows hash to the checklist value the latest plan pass records in §10", () => {
    const passes = logRows.filter((cells) => cells[0].startsWith("plan r"));
    const recorded = /checklist `([0-9a-f]{12})`/.exec(
      passes[passes.length - 1].join(" | "),
    )?.[1];

    expect({ recorded }).toEqual({ recorded: checklistHash(plan) });
  });
});

/** Which WP owns each row ID: §4's `### WPn` subsections and Appendix A's WP column. */
function owners(markdown: string): Map<string, string> {
  const owner = new Map<string, string>();
  const packages = section(markdown, "## 4. Work packages").split("\n### ");
  for (const text of packages) {
    const wp = /^(WP\d)\b/.exec(text)?.[1];
    if (wp) for (const id of tableIds(text)) owner.set(id, wp);
  }
  for (const cells of ridRows) {
    if (/^\d$/.test(cells[1])) owner.set(cells[0], `WP${cells[1]}`);
  }
  return owner;
}

/** The §12 steps whose Expected cell names a row or R-id that `wp` owns, in §12's order. */
function deviceSteps(
  wp: string,
  owner: Map<string, string>,
  expected: Map<string, string>,
): string[] {
  const mine = [...owner].filter(([, w]) => w === wp).map(([id]) => id);
  return [...expected]
    .filter(([, text]) => mine.some((id) => namesId(text, id)))
    .map(([step]) => step);
}

/** The latest verdicts: WP → its verdict and its open items (`WPn-…`). */
function verdicts(markdown: string) {
  const table = tables(section(markdown, "## 10. Iteration log"))
    .filter(({ header }) => header.join(" | ") === "WP | Verdict | Open items")
    .pop()!;
  return table.rows.map(([wp, verdict, open]) => ({
    wp,
    verdict,
    open: [...open.matchAll(/`(WP\d-[\w-]+)`/g)].map((m) => m[1]),
  }));
}

/** The verdict a WP must read, from its open items and its §12 steps (§2). */
function verdictFor(open: string[], device: string[]): RegExp {
  const qa = device.length
    ? ` · device QA pending \\(§12 ${device.join(", ")}\\)`
    : "";
  return new RegExp(`^${open.length ? "open" : "PASS \\(automated\\)"}${qa}$`);
}

describe("§10: each verdict follows from Appendix A, its open items and §12", () => {
  const owner = owners(plan);
  const latest = verdicts(plan);

  it("reads a verdict from its open items and device steps", () => {
    expect("PASS (automated)").toMatch(verdictFor([], []));
    expect("PASS (automated) · device QA pending (§12 4, 9a)").toMatch(
      verdictFor([], ["4", "9a"]),
    );
    expect("PASS (automated) · device QA pending (§12 4)").not.toMatch(
      verdictFor([], ["4", "9a"]),
    );
    expect("PASS (automated)").not.toMatch(verdictFor(["WP0-x"], []));
    expect("open · device QA pending (§12 14)").toMatch(
      verdictFor(["WP6-x"], ["14"]),
    );
  });

  it("lists WP0–WP6 once each", () => {
    expect(latest.map(({ wp }) => wp)).toEqual([
      "WP0",
      "WP1",
      "WP2",
      "WP3",
      "WP4",
      "WP5",
      "WP6",
    ]);
  });

  it.each(latest.map(({ wp, verdict, open }) => [wp, verdict, open]))(
    "%s reads %p: PASS only with no open item, and device QA pending on exactly the §12 steps that name its rows (open: %j)",
    (wp, verdict, open) => {
      expect(verdict).toMatch(
        verdictFor(open, deviceSteps(wp, owner, expectedOf)),
      );
    },
  );

  it("an Appendix A row marked ❌ is open under its WP, which therefore cannot read PASS", () => {
    const failing = ridRows
      .filter((cells) => cells[4].includes("❌"))
      .map((cells) => ({
        id: cells[0],
        item: /^open · `(WP\d-[\w-]+)`/.exec(cells[4])?.[1],
        wp: `WP${cells[1]}`,
      }));

    expect(
      failing.filter(
        ({ item, wp }) =>
          !latest.find((v) => v.wp === wp)?.open.includes(item ?? ""),
      ),
    ).toEqual([]);
  });
});

/**
 * The findings of the two independent gradings, from their reports (which
 * live outside the repo): r4 (85 findings) and r5 (53). Majors are the
 * severities after each grading's skeptic pass; everything else is minor.
 */
const range = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
const GRADED = [
  ...range("PP-", 13),
  ...range("G", 10),
  ...range("TSR-", 13),
  ...range("WP1-MP-", 8),
  ...range("F", 5),
  ...range("M", 11),
  ...range("TQ-", 11),
  ...range("ENG-", 14),
  ...range("PP2-", 8),
  ...range("TSR2-", 7),
  ...range("ENG2-", 5),
  ...range("PG2-", 8),
  ...range("TQ2-", 11),
  ...range("WP6R2-", 8),
  ...range("WP1-R2-", 6),
];
const MAJORS = new Set(
  (
    "PP-1 PP-2 PP-3 G1 G2 G4 TSR-1 TSR-2 TSR-5 WP1-MP-1 WP1-MP-2 F1 F3 F4 F5 " +
    "TQ-1 ENG-1 ENG-2 ENG-3 PP2-2 TSR2-1 PG2-1 PG2-2"
  ).split(" "),
);
/** The lens of each grader (§0): product, process or engineering. */
function lensOf(finding: string): string {
  const grader = /^([A-Z]+)/.exec(finding)![1];
  if (grader === "PP") return "product";
  if (["G", "PG", "TQ"].includes(grader)) return "process";
  return "engineering";
}

type Entry = {
  finding: string;
  lens: string;
  severity: string;
  disposition: string;
  rows: string;
  proof: string;
};

/** The ledger's rows (Appendix D). */
function ledger(markdown: string): Entry[] {
  const at = markdown.indexOf("\n## Appendix D");
  return tables(at < 0 ? "" : markdown.slice(at))
    .filter(({ header }) => header[0] === "Finding")
    .flatMap(({ rows }) =>
      rows.map(([finding, lens, severity, disposition, rows_, proof]) => ({
        finding,
        lens,
        severity,
        disposition,
        rows: rows_,
        proof,
      })),
    );
}

/** The text a passage reference points at: `§4`, a row (`E6`) or a §12 step (`step 9a`). */
function passage(where: string, markdown: string): string | undefined {
  const heading = /^§(\d+)$/.exec(where);
  if (heading) {
    const start = markdown.search(new RegExp(`\\n## ${heading[1]}\\. `));
    return start < 0
      ? undefined
      : section(markdown, markdown.slice(start + 1).split("\n")[0]);
  }
  const id = /^step (\w+)$/.exec(where)?.[1] ?? where;
  return markdown
    .split("\n")
    .find((line) => line.trimStart().startsWith(`| ${id} |`));
}

type Proof = { ref: string; holds: boolean };

/**
 * Every reference a ledger Proof cell names, and whether it holds: a test
 * title (`file › title`), a pytest function, `grep -cF "text" file` → `n`
 * (rid-map counts the lines itself), an npm script, or a plan passage
 * (`§1 ∋ "…"`, `E6 ∋ "…"`, `step 9a ∋ "…"`).
 */
function proofsIn(cell: string, markdown: string, allTitles: Title[]): Proof[] {
  const found: Proof[] = [];
  let rest = cell;
  for (const m of cell.matchAll(
    /`grep -cF (?:"([^"`]+)"|'([^'`]+)') ([^`\s]+)` → `(\d+)`/g,
  )) {
    const text = m[1] ?? m[2];
    const lines = read(m[3]).split("\n");
    const count = lines.filter((line) => line.includes(text)).length;
    found.push({ ref: m[0], holds: count === Number(m[4]) });
    rest = rest.replace(m[0], "");
  }
  for (const m of rest.matchAll(/`([^`]+ › [^`]+)`/g)) {
    found.push({
      ref: m[1],
      holds: resolveTitle(m[1], allTitles) !== undefined,
    });
  }
  for (const m of rest.matchAll(/`(test_\w+)`/g)) {
    found.push({ ref: m[1], holds: pytest.includes(m[1]) });
  }
  for (const m of rest.matchAll(/`npm run ([\w:-]+)`/g)) {
    found.push({ ref: m[0], holds: m[1] in scripts });
  }
  for (const m of rest.matchAll(
    /(§\d+|step \w+|R\d{2}|[A-Z]{1,2}\d{1,2}[a-z]?) ∋ "([^"]+)"/g,
  )) {
    found.push({
      ref: m[0],
      holds: passage(m[1], markdown)?.includes(m[2]) ?? false,
    });
  }
  return found;
}

/** §0's waiver bullets. */
const waivers = section(plan, "## 0. Plan self-assessment")
  .split("**Minor critique points waived")[1]
  .split("\n")
  .filter((line) => line.startsWith("- "));

/** A lens's grade by §0's definition: 10 with nothing open, 9 with only minors open, at most 8 with a major open. */
function gradeOf(entries: Pick<Entry, "severity" | "disposition">[]): string {
  const open = entries.filter(({ disposition }) => disposition === "open");
  if (open.some(({ severity }) => severity === "major")) return "≤ 8";
  return open.length ? "9" : "10";
}

describe("Appendix D: every graded finding has one checked disposition, and §0's grade follows", () => {
  const entries = ledger(plan);
  const openItems = verdicts(plan).flatMap(({ open }) => open);
  const disposed = (...kinds: string[]) =>
    entries
      .filter(({ disposition }) => kinds.includes(disposition))
      .map(({ finding, proof }) => [finding, proof]);

  it("reads the references in a proof cell, and checks each kind", () => {
    const cell = [
      '`grep -cF "zz-not-in-it" package.json` → `0`',
      '`grep -cF \'"name": "djir"\' package.json` → `0`',
      "`lib/tracking › T5: counts real minutes down to a scheduled departure`",
      "`lib/tracking › T5: counts …`",
      "`lib/tracking › T5: nope`",
      "`test_r26_models_load_cleanly_with_the_pinned_versions`",
      "`test_nope`",
      "`npm run check`",
      "`npm run nope`",
      '§1 ∋ "Roadmap item"',
      'T1 ∋ "departAt"',
      'step 9a ∋ "never there"',
    ].join(" · ");

    expect(proofsIn(cell, body, titles).map(({ holds }) => holds)).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  it("grades a lens 10 with nothing open, 9 with only minors open, and at most 8 with a major open", () => {
    const closed = { severity: "major", disposition: "fixed" };
    const minor = { severity: "minor", disposition: "open" };
    const major = { severity: "major", disposition: "open" };

    expect(gradeOf([closed, { ...minor, disposition: "waived" }])).toBe("10");
    expect(gradeOf([closed, minor])).toBe("9");
    expect(gradeOf([minor, major])).toBe("≤ 8");
  });

  it("lists every finding of both gradings exactly once (85 + 53)", () => {
    expect(entries.map(({ finding }) => finding).sort()).toEqual(
      [...GRADED].sort(),
    );
  });

  it.each(entries.map((e) => [e.finding, `${e.lens} · ${e.severity}`]))(
    "%s: its lens and severity are the graders' (%s)",
    (finding, lensAndSeverity) => {
      expect(lensAndSeverity).toBe(
        `${lensOf(finding)} · ${MAJORS.has(finding) ? "major" : "minor"}`,
      );
    },
  );

  it.each(entries.map((e) => [e.finding, e.disposition, e.rows]))(
    "%s is %s, never a waived major, and the rows it names are rows of the plan (%s)",
    (finding, disposition, rows) => {
      expect(["fixed", "fixed, part waived", "waived", "open"]).toContain(
        disposition,
      );
      expect(MAJORS.has(finding) && disposition.includes("waived")).toBe(false);
      expect(
        rows === "—" ? [] : rows.split(/[ ,]+/).filter((id) => !known.has(id)),
      ).toEqual([]);
    },
  );

  it.each(disposed("fixed", "fixed, part waived"))(
    "%s: fixed — it names a proof, and every test title, pytest function, grep, npm script and plan passage it names holds (%s)",
    (_, proof) => {
      const found = proofsIn(proof, body, titles);
      expect(found.length).toBeGreaterThan(0);
      expect(found.filter(({ holds }) => !holds)).toEqual([]);
    },
  );

  it.each(disposed("waived", "fixed, part waived"))(
    "%s: waived — a §0 bullet names it (%s)",
    (finding) => {
      expect(waivers.filter((line) => namesId(line, finding))).not.toEqual([]);
    },
  );

  it.each(disposed("open"))(
    "%s: open — its item is open in a §10 verdict (%s)",
    (_, proof) => {
      const items = [...proof.matchAll(/`(WP\d-[\w-]+)`/g)].map((m) => m[1]);
      expect(items.length).toBeGreaterThan(0);
      expect(items.filter((item) => !openItems.includes(item))).toEqual([]);
    },
  );

  it("§0's latest grade is the one the ledger gives, lens by lens (product · process · engineering)", () => {
    const revisions = tables(section(plan, "## 0. Plan self-assessment")).find(
      ({ header }) => header[0] === "Rev",
    )!.rows;
    const latest = revisions[revisions.length - 1][1];
    const [product, process, engineering] = /\*\*(\d+) · (\d+) · (\d+)\*\*/
      .exec(latest)!
      .slice(1);
    const by = (lens: string) => entries.filter((e) => e.lens === lens);
    const recorded = (grade: string, computed: string) =>
      computed === "≤ 8" && Number(grade) <= 8 ? computed : grade;

    expect({
      product: recorded(product, gradeOf(by("product"))),
      process: recorded(process, gradeOf(by("process"))),
      engineering: recorded(engineering, gradeOf(by("engineering"))),
    }).toEqual({
      product: gradeOf(by("product")),
      process: gradeOf(by("process")),
      engineering: gradeOf(by("engineering")),
    });
  });
});

/**
 * The runs of `example` that are not copied from `source`. Lines are compared
 * trimmed and blank lines are ignored; a line with "…" ends a run. Each run
 * must be consecutive lines of the source, after the previous run.
 */
function notCopied(example: string, source: string): string[] {
  const code = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const runs: string[][] = [[]];
  for (const line of example.split("\n").map((l) => l.trim())) {
    if (line.includes("…")) runs.push([]);
    else if (line) runs[runs.length - 1].push(line);
  }
  const missing: string[] = [];
  let next = 0;
  for (const run of runs.filter((lines) => lines.length > 0)) {
    let at = next;
    while (
      at + run.length <= code.length &&
      !run.every((line, k) => code[at + k] === line)
    ) {
      at++;
    }
    if (at + run.length > code.length) missing.push(run.join(" ⏎ "));
    else next = at + run.length;
  }
  return missing;
}

describe("§8: the style examples are copied from the code", () => {
  it("reads an example as runs of the code's lines, where only '…' may skip some", () => {
    const source = "a();\n\nb();\nc();\nd();\n";

    expect(notCopied("a();\nb();", source)).toEqual([]);
    expect(notCopied("a();\n// …\nd();", source)).toEqual([]);
    expect(notCopied("a();\nc();", source)).toEqual(["a(); ⏎ c();"]);
    expect(notCopied("c();\n// …\na();", source)).toEqual(["a();"]);
    expect(notCopied("e();", source)).toEqual(["e();"]);
  });

  const examples = [
    ...section(plan, "## 8. Coding style").matchAll(
      /```\w+\n(?:\/\/|#) from (\S+)\n([\s\S]*?)```/g,
    ),
  ].map((m) => [m[1], m[2]]);

  it("finds the pure module, route, hook, component and test examples", () => {
    expect(examples.map(([file]) => file)).toEqual(
      expect.arrayContaining([
        "lib/tracking.ts",
        "app/(api)/ride/confirm+api.ts",
        "hooks/useRideTracking.ts",
        "components/TrackingSheet.tsx",
        "__tests__/api/booking.test.ts",
      ]),
    );
  });

  it.each(examples)(
    "%s: its example is that file's lines, in order, with nothing left out except where '…' marks a gap",
    (file, example) => {
      expect(notCopied(example, read(file))).toEqual([]);
    },
  );
});

describe("§9: the coverage table is jest.config.js's thresholds", () => {
  it("C3: lists exactly the gates, lines and branches jest.config.js enforces", () => {
    const table = tables(section(plan, "## 9. Tests & CI")).find(
      ({ header }) => header[0] === "Paths",
    )!;
    const percent = (cell: string) =>
      cell === "—" ? undefined : Number(/(\d+)%/.exec(cell)![1]);
    const gates = Object.fromEntries(
      table.rows.flatMap(([paths, lines, branches]) =>
        [...paths.matchAll(/`([^`]+)`/g)]
          .flatMap(([, glob]) => {
            const brace = /\{([^}]+)\}/.exec(glob);
            return brace
              ? brace[1].split(",").map((name) => glob.replace(brace[0], name))
              : [glob];
          })
          .map((glob) => [
            `./${glob}`,
            JSON.parse(
              JSON.stringify({
                lines: percent(lines),
                branches: percent(branches),
              }),
            ),
          ]),
      ),
    );

    expect(gates).toEqual(require("../../jest.config.js").coverageThreshold);
  });
});

it("titles name rows of §2, §4, §6 or Appendix A — never a claim of Appendix B — and no typos such as S10 or R80", () => {
  const unknown = titles.flatMap(({ file, title, ids }) =>
    ids
      .filter((id) => !known.has(id))
      .map((id) => `${file}: ${id} in "${title}"`),
  );
  expect(unknown).toEqual([]);
});
