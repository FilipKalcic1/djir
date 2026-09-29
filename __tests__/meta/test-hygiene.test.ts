/**
 * Keeps the suite honest (plan WP0 meta tests and §9): no test is focused,
 * skipped, left as a todo or proven by a snapshot, no production code opts
 * out of coverage (no file is exempt), and every lib/ export carries
 * the JSDoc that plan §8 asks of a pure module. The forbidden words are
 * assembled from parts, so this file can scan itself without matching.
 */
import ts from "typescript";

import { filesUnder, read } from "../helpers/repo";

type Rule = { name: string; pattern: RegExp };

const PRODUCTION_DIRS = [
  "lib",
  "server",
  "services",
  "hooks",
  "components",
  "app",
  "store",
];
const SOURCE_FILE = /\.[jt]sx?$/;

const word = (...parts: string[]) => parts.join("");
const TEST_FNS = "describe|it|test";
const NOT_A_MEMBER = "(?<![\\w$.])";

const FOCUS_RULES: Rule[] = [
  {
    name: "focused, skipped or todo test",
    pattern: new RegExp(
      `${NOT_A_MEMBER}(?:${TEST_FNS})(?:\\.\\w+)*\\.(?:${word("on", "ly")}|${word("sk", "ip")}|${word("to", "do")})\\b`,
    ),
  },
  {
    name: "x- or f-prefixed test",
    pattern: new RegExp(
      `${NOT_A_MEMBER}[${word("x", "f")}](?:${TEST_FNS})\\s*[.(]`,
    ),
  },
];
const SNAPSHOT_RULES: Rule[] = [
  {
    name: "snapshot assertion",
    pattern: new RegExp(
      `\\b(?:toMatch|toThrowErrorMatching)(?:Inline)?${word("Snap", "shot")}\\b`,
    ),
  },
];
const TEST_RULES = [...FOCUS_RULES, ...SNAPSHOT_RULES];

const COVERAGE_RULES: Rule[] = [
  {
    name: "coverage opt-out",
    pattern: new RegExp(`\\b(?:istanbul|c8|v8)\\s+${word("ign", "ore")}\\b`),
  },
];

/** Repo-relative paths (forward slashes) of the source files under `dir`. */
const sourceFilesUnder = (dir: string) => filesUnder(dir, SOURCE_FILE);

/** `file:line rule: text` for every line of `source` that breaks a rule. */
function violations(file: string, source: string, rules: Rule[]): string[] {
  return source
    .split(/\r?\n/)
    .flatMap((text, index) =>
      rules
        .filter((rule) => rule.pattern.test(text))
        .map((rule) => `${file}:${index + 1} ${rule.name}: ${text.trim()}`),
    );
}

const scan = (files: string[], rules: Rule[]) =>
  files.flatMap((file) => violations(file, read(file), rules));

/** `file:line name` for every top-level export of `source` without a JSDoc block. */
function undocumentedExports(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return tree.statements
    .filter(
      (statement) =>
        ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    )
    .filter(
      (statement) =>
        !(
          ts.getLeadingCommentRanges(source, statement.getFullStart()) ?? []
        ).some(
          (range) =>
            range.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
            source.startsWith("/**", range.pos),
        ),
    )
    .map((statement) => {
      const { line } = tree.getLineAndCharacterOfPosition(statement.getStart());
      const name = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations[0].name.getText()
        : ((statement as ts.DeclarationStatement).name?.getText() ?? "?");
      return `${file}:${line + 1} ${name}`;
    });
}

describe("the detector", () => {
  const FOCUSED = "focused, skipped or todo test";
  const PREFIXED = "x- or f-prefixed test";
  const SNAPSHOT = "snapshot assertion";

  it.each([
    [`${word("it.", "only")}("x", () => {});`, FOCUSED],
    [`${word("describe.", "only")}("x", () => {});`, FOCUSED],
    [`${word("test.", "skip")}("x", () => {});`, FOCUSED],
    [`${word("it.", "todo")}("x");`, FOCUSED],
    [`${word("it.concurrent.", "only")}("x", async () => {});`, FOCUSED],
    [`${word("describe.", "skip")}.each([1])("x %p", () => {});`, FOCUSED],
    [`${word("x", "it")}("x", () => {});`, PREFIXED],
    [`${word("x", "describe")}("x", () => {});`, PREFIXED],
    [`${word("x", "test")}("x", () => {});`, PREFIXED],
    [`${word("f", "it")}("x", () => {});`, PREFIXED],
    [`${word("f", "describe")}("x", () => {});`, PREFIXED],
    [`${word("x", "it")}.each([1])("x %p", () => {});`, PREFIXED],
    [`expect(tree).${word("toMatch", "Snapshot")}();`, SNAPSHOT],
    [`expect(tree).${word("toMatchInline", "Snapshot")}(\`x\`);`, SNAPSHOT],
    [`expect(fn).${word("toThrowErrorMatching", "Snapshot")}();`, SNAPSHOT],
  ])("flags %s as a %s", (line, rule) => {
    expect(violations("__tests__/x.test.ts", `  ${line}`, TEST_RULES)).toEqual([
      `__tests__/x.test.ts:1 ${rule}: ${line}`,
    ]);
  });

  it.each([
    'it.each([1])("x %p", () => {});',
    'describe("the only way", () => {});',
    'test("skips nothing", () => {});',
    "mapRef.current.fitToCoordinates(points);",
    "const profit = benefit(fare);",
    "const todo = rides.filter(isSkipped);",
    'expect(tree).toMatchObject({ phase: "en_route" });',
  ])("leaves %s alone", (line) => {
    expect(violations("__tests__/x.test.ts", line, TEST_RULES)).toEqual([]);
  });

  it("names the file and the line of each violation", () => {
    const focused = `${word("it.", "only")}("x", () => {});`;
    const snapshot = `expect(tree).${word("toMatch", "Snapshot")}();`;
    const optOut = `/* ${word("istanbul ", "ign", "ore")} next */`;

    expect(
      violations(
        "__tests__/x.test.ts",
        ["import x from 'x';", focused, "", snapshot].join("\r\n"),
        TEST_RULES,
      ),
    ).toEqual([
      `__tests__/x.test.ts:2 focused, skipped or todo test: ${focused}`,
      `__tests__/x.test.ts:4 snapshot assertion: ${snapshot}`,
    ]);
    expect(
      violations(
        "lib/x.ts",
        ["const a = 1;", optOut].join("\n"),
        COVERAGE_RULES,
      ),
    ).toEqual([`lib/x.ts:2 coverage opt-out: ${optOut}`]);
  });

  it("flags each export without a JSDoc block, whatever it declares, and nothing else", () => {
    const source = [
      "/** Documented. */",
      "export function documented() {}",
      "export function bare() {}",
      "// A line comment is not a JSDoc.",
      "export const arrow = () => 1;",
      "/* Nor is a plain block comment. */",
      "export type Shape = { x: number };",
      "export interface Point { x: number }",
      "export class Box {}",
      "/**",
      " * Documented over several lines.",
      " */",
      "export const TOKEN = 1;",
      "function internal() {}",
      "const hidden = internal;",
      "export { hidden as shown };",
    ].join("\n");

    expect(undocumentedExports("lib/x.ts", source)).toEqual([
      "lib/x.ts:3 bare",
      "lib/x.ts:5 arrow",
      "lib/x.ts:7 Shape",
      "lib/x.ts:8 Point",
      "lib/x.ts:9 Box",
    ]);
  });
});

describe("the suite", () => {
  const testFiles = sourceFilesUnder("__tests__");

  it("scans every test file, this one included", () => {
    expect(testFiles).toEqual(
      expect.arrayContaining([
        "__tests__/meta/test-hygiene.test.ts",
        "__tests__/timezone.sentinel.test.ts",
        "__tests__/api/booking.test.ts",
      ]),
    );
  });

  it("has no focused, skipped, todo or x/f-prefixed tests", () => {
    expect(scan(testFiles, FOCUS_RULES)).toEqual([]);
  });

  it("has no snapshot assertions", () => {
    expect(scan(testFiles, SNAPSHOT_RULES)).toEqual([]);
  });
});

describe("production code", () => {
  const productionFiles = PRODUCTION_DIRS.flatMap(sourceFilesUnder);

  it("scans lib, server, services, hooks, components, app and store", () => {
    expect(
      PRODUCTION_DIRS.filter(
        (dir) => !productionFiles.some((file) => file.startsWith(`${dir}/`)),
      ),
    ).toEqual([]);
  });

  it("has no coverage opt-outs, in any file", () => {
    expect(scan(productionFiles, COVERAGE_RULES)).toEqual([]);
  });

  it("documents every lib/ export with a JSDoc block (plan §8: pure modules)", () => {
    const libFiles = sourceFilesUnder("lib");

    expect(libFiles).toEqual(expect.arrayContaining(["lib/pricing.ts"]));
    expect(
      libFiles.flatMap((file) => undocumentedExports(file, read(file))),
    ).toEqual([]);
  });
});
