/**
 * Reads the build plan's tables and the test suite's titles, so the meta tests
 * can hold one to the other (plan §2 C1–C5, §8 "Tests").
 *
 * A Jest test proves a row only through an `it`/`test` title that STARTS with
 * the row's ID and a colon closes that prefix: "T3: …", "R04 R08: …",
 * "MP2/MP3: …", "P4 Android: …". An ID in a describe title or in the middle of
 * a title proves nothing. An `.each` title is read the way Jest prints it for
 * each row of the literal array passed to that `.each` ("%s: …" with a row
 * ["S5", …] names S5); with any other table its placeholders name nothing.
 */
import fs from "fs";
import path from "path";

import ts from "typescript";

import { filesUnder, read, REPO_ROOT } from "./repo";

export { read, REPO_ROOT };

const ID = String.raw`(?:R\d{2}|[A-Z]{1,2}\d{1,2}[a-z]?)`;
/** A row ID: R01, S4, PT1, B1a, P3b, MP2, J1c … */
export const IS_ROW_ID = new RegExp(`^${ID}$`);

/** The markdown section that starts with `heading` (up to the next heading of the same level). */
export function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`No section "${heading}" in the plan`);
  const level = heading.match(/^#+/)![0];
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(new RegExp(`\\n${level} `));
  return end < 0 ? rest : rest.slice(0, end);
}

const isTableLine = (line: string) => line.trimStart().startsWith("|");

function cellsOf(line: string): string[] {
  const row = line.trim();
  return row
    .slice(1, row.endsWith("|") ? -1 : undefined)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/**
 * The cells of every table row in `markdown`, indented tables included
 * (header and divider rows too).
 */
export function tableRows(markdown: string): string[][] {
  return markdown.split("\n").filter(isTableLine).map(cellsOf);
}

/** A markdown table: its header cells and its body rows (the divider dropped). */
export type Table = { header: string[]; rows: string[][] };

/** Every table in `markdown`, indented ones included, in order. */
export function tables(markdown: string): Table[] {
  const found: string[][][] = [];
  let lines: string[][] | null = null;
  for (const line of markdown.split("\n")) {
    if (isTableLine(line)) {
      if (!lines) found.push((lines = []));
      lines.push(cellsOf(line));
    } else {
      lines = null;
    }
  }
  return found.map(([header, ...body]) => ({
    header,
    rows: body.filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c))),
  }));
}

/** Jest test files, repo-relative. */
export const jestFiles = () => filesUnder("__tests__", /\.test\.tsx?$/);

/** One `describe`, `it` or `test` call, and the row IDs its title starts with. */
export type Title = {
  file: string;
  kind: "describe" | "it" | "test";
  title: string;
  ids: string[];
  /**
   * An `it`/`test`'s own code: its callback, its `.each` table, and every
   * file-level declaration that code names, followed transitively (so a
   * `const confirmButton = () => screen.getByTestId(…)` helper counts). Empty
   * for a describe.
   */
  source: string;
};

/** The file-level functions and variables of `tree`, by name, with their code. */
function fileScope(tree: ts.SourceFile): Map<string, string> {
  const scope = new Map<string, string>();
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      scope.set(statement.name.text, statement.getText());
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          scope.set(declaration.name.text, declaration.getText());
        }
      }
    }
  }
  return scope;
}

/** `code`, plus every file-level declaration it names, followed transitively. */
export function withHelpers(code: string, scope: Map<string, string>): string {
  const parts = [code];
  const seen = new Set<string>();
  const queue = [code];
  while (queue.length > 0) {
    for (const [name] of queue.pop()!.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const helper = scope.get(name);
      if (helper !== undefined && !seen.has(name)) {
        seen.add(name);
        parts.push(helper);
        queue.push(helper);
      }
    }
  }
  return parts.join("\n");
}

/** Unwraps `x as const`, `(x)` and `x satisfies T`. */
function bare(node: ts.Expression): ts.Expression {
  let inner = node;
  while (
    ts.isAsExpression(inner) ||
    ts.isParenthesizedExpression(inner) ||
    ts.isSatisfiesExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map((span) => `\${${span.expression.getText()}}${span.literal.text}`)
        .join("")
    );
  }
  return undefined;
}

const column = (index: number) => (row: ts.Expression) =>
  ts.isArrayLiteralExpression(row)
    ? row.elements[index]
    : index === 0
      ? row
      : undefined;

const property = (key: string) => (row: ts.Expression) =>
  ts.isObjectLiteralExpression(row)
    ? row.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText() === key,
      )?.initializer
    : undefined;

/**
 * The title Jest prints for one `.each` row: "%s" and "$key" take the row's
 * string, every other placeholder (and anything not a literal) prints "·".
 */
function rendered(title: string, row: ts.Expression | undefined): string {
  let index = 0;
  const text = (node: ts.Node | undefined) =>
    (node && literalText(node)) ?? "·";
  return title.replace(/%%|%([psdifjo#])|\$(\w+)/g, (token, kind, key) => {
    if (token === "%%") return "%";
    if (key) return text(row && property(key)(row));
    const cell = row && column(index++)(row);
    return kind === "s" ? text(cell) : "·";
  });
}

/** The IDs a printed title starts with: "T3: …", "R04 R08: …", "P4 Android: …". */
function leadingIds(title: string): string[] {
  const colon = title.indexOf(":");
  if (colon <= 0) return [];
  const ids: string[] = [];
  for (const token of title.slice(0, colon).split(/[ /,]+/)) {
    if (!IS_ROW_ID.test(token)) break;
    ids.push(token);
  }
  return ids;
}

/**
 * The row IDs `title` starts with. An `.each` title is read once per row of
 * the literal array passed to that `.each`, as Jest prints it; with any other
 * table its placeholders name nothing.
 */
export function idsNamed(title: string, table?: ts.Expression): string[] {
  if (table === undefined) return leadingIds(title);
  const rows = ts.isArrayLiteralExpression(bare(table))
    ? (bare(table) as ts.ArrayLiteralExpression).elements.map(bare)
    : [undefined];
  return [...new Set(rows.flatMap((row) => leadingIds(rendered(title, row))))];
}

/** The `describe` / `it` / `test` calls in one test file's `source`. */
export function titlesIn(file: string, source: string): Title[] {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Title[] = [];
  const scope = fileScope(tree);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      let callee: ts.Expression = node.expression;
      let table: ts.Expression | undefined;
      if (
        ts.isCallExpression(callee) &&
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === "each"
      ) {
        table = callee.arguments[0];
        callee = callee.expression.expression;
      }
      const kind = ts.isIdentifier(callee) ? callee.text : "";
      const title = literalText(node.arguments[0]);
      if (
        (kind === "describe" || kind === "it" || kind === "test") &&
        title !== undefined
      ) {
        const code = [node.arguments[1], table]
          .map((part) => part?.getText() ?? "")
          .join("\n");
        found.push({
          file,
          kind,
          title,
          ids: idsNamed(title, table),
          source: kind === "describe" ? "" : withHelpers(code, scope),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** Every `describe`, `it` and `test` title in the Jest suite. */
export function jestTitles(): Title[] {
  return jestFiles().flatMap((file) => titlesIn(file, read(file)));
}

/**
 * For each row ID, the test files with an `it`/`test` title that starts with
 * it. Describe titles never prove a row.
 */
export function provenIn(titles: Title[]): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  for (const { file, kind, ids } of titles) {
    if (kind === "describe") continue;
    for (const id of ids) {
      if (!files.has(id)) files.set(id, new Set());
      files.get(id)!.add(file);
    }
  }
  return files;
}

/** Pytest functions (`test_r06_…`), from ml-platform/tests. */
export function pytestFunctions(): string[] {
  return filesUnder("ml-platform/tests", /^test_.*\.py$/).flatMap((file) =>
    [...read(file).matchAll(/^def (test_\w+)\(/gm)].map((m) => m[1]),
  );
}

/** The R-ids a pytest function is named for: test_r27_r36_… → R27, R36. */
export function pytestRidsOf(name: string): string[] {
  const prefix = /^test((?:_r\d{2})+)_/.exec(name);
  return prefix
    ? prefix[1]
        .split("_")
        .filter(Boolean)
        .map((r) => `R${r.slice(1)}`)
    : [];
}

/** R-ids named by pytest functions. */
export function pytestRids(): Set<string> {
  return new Set(pytestFunctions().flatMap(pytestRidsOf));
}

const TEST_DIRS =
  "api|components|config|db|hooks|lib|meta|screens|server|services|store";

/** The Jest test file a plan cell cites as `api/booking`, if it exists. */
export function testFile(ref: string): string | undefined {
  return [`__tests__/${ref}.test.ts`, `__tests__/${ref}.test.tsx`].find((f) =>
    fs.existsSync(path.join(REPO_ROOT, f)),
  );
}

/** The Jest test files a proof cell cites: `api/booking` → "api/booking". */
export function citedTests(cell: string): string[] {
  return [
    ...cell.matchAll(new RegExp(`\`((?:${TEST_DIRS})/[\\w.-]+)\``, "g")),
  ].map((m) => m[1]);
}

/** The pytest functions a proof cell cites: `test_r06_*` or a full name. */
export function citedPytest(cell: string): string[] {
  return [...cell.matchAll(/`(test_\w+\*?)`/g)].map((m) => m[1]);
}

/** The pytest functions `ref` (`test_r25_*` or an exact name) points at. */
export function pytestMatching(ref: string, functions: string[]): string[] {
  return ref.endsWith("*")
    ? functions.filter((name) => name.startsWith(ref.slice(0, -1)))
    : functions.filter((name) => name === ref);
}

/**
 * The Jest title a register cell names as `file › title` (a trailing "…"
 * makes it a prefix), or undefined when no describe/it/test in that file has
 * that title.
 */
export function resolveTitle(ref: string, titles: Title[]): Title | undefined {
  const m = /^([\w./-]+) › (.+)$/.exec(ref);
  if (!m) return undefined;
  const file = testFile(m[1]);
  const text = m[2].trim();
  const prefix = text.endsWith("…") ? text.slice(0, -1).trimEnd() : null;
  return titles.find(
    (t) =>
      t.file === file &&
      (prefix === null ? t.title === text : t.title.startsWith(prefix)),
  );
}

/** The step numbers of the §12 manual QA table ("1", "9a", "10b" …). */
export function qaSteps(plan: string): string[] {
  return [...qaExpected(plan).keys()];
}

/** Each §12 step's Expected cell, by step number, in the table's order. */
export function qaExpected(plan: string): Map<string, string> {
  const table = tables(section(plan, "## 12. Manual QA")).find(
    ({ header }) => header[0] === "#",
  );
  const at = table?.header.indexOf("Expected") ?? -1;
  return new Map(
    (table?.rows ?? []).map((cells) => [cells[0], at < 0 ? "" : cells[at]]),
  );
}

/** Whether `text` names the row `id` as a whole token ("B1a", not "B1" in "B1a"). */
export function namesId(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(text);
}

/** The §12 steps a QA cell names ("9a / 12"), or null if a part is neither a step nor `auto`. */
export function qaCell(cell: string, steps: string[]): string[] | null {
  const parts = cell.split(/\s*[/,]\s*/);
  return parts.every((part) => part === "auto" || steps.includes(part))
    ? parts.filter((part) => part !== "auto")
    : null;
}
