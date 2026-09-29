/**
 * The red → green tool (plan §2 C3, README claim B11). scripts/mutants.json
 * must still put each critical v1.0 bug back: every find string sits exactly
 * once where its mutant expects it, and every mutant runs tests titled with
 * its R-id. scripts/mutants.mjs must count only a failed assertion as a kill
 * and never leave a mutant in the tree. The runner is exercised in a scratch
 * copy of the repo with a stub Jest, so this file never mutates real code.
 */
import { ChildProcess, spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

import { jestTitles, pytestFunctions } from "../helpers/plan";
import { read, REPO_ROOT } from "../helpers/repo";

type Mutant = {
  id: string;
  bug: string;
  file: string;
  find?: string;
  replace?: string;
  create?: string;
  jest?: string[];
  pytest?: string;
};
type Verdict = { status: string; detail: string };

jest.setTimeout(60_000);

const SCRIPT = path.join(REPO_ROOT, "scripts/mutants.mjs");
const MUTANTS: Mutant[] = JSON.parse(read("scripts/mutants.json"));
const CRITICAL_FINDINGS = Array.from(
  { length: 11 },
  (_, i) => `R${String(i + 1).padStart(2, "0")}`,
);

describe("scripts/mutants.json", () => {
  it("C3: holds one mutant per critical v1.0 finding, in order, each either editing or creating a file and naming its tests", () => {
    expect(MUTANTS.map((m) => m.id)).toEqual(CRITICAL_FINDINGS);
    expect(
      MUTANTS.filter(
        (m) =>
          !m.bug ||
          (m.find === undefined) === (m.create === undefined) ||
          (m.find !== undefined && m.replace === undefined) ||
          (m.jest === undefined) === (m.pytest === undefined),
      ).map((m) => m.id),
    ).toEqual([]);
  });

  it.each(MUTANTS.filter((m) => m.find !== undefined))(
    "C3: $id's find string occurs exactly once in $file, and its replacement is different code",
    ({ file, find, replace }) => {
      const source = read(file);

      expect(source.split(find!).length - 1).toBe(1);
      expect(replace).not.toBe(find);
    },
  );

  it.each(MUTANTS.filter((m) => m.create !== undefined))(
    "C3: $id's $file does not exist, so creating it puts the bug back",
    ({ file }) => {
      expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(false);
    },
  );

  it.each(MUTANTS)(
    "C3: $id runs tests that exist and are titled with it",
    ({ id, jest: paths, pytest }) => {
      const titled = new RegExp(`\\b${id}\\b`);
      if (paths) {
        const titles = jestTitles().filter(({ file }) =>
          paths.some((p) => file === p || file.startsWith(`${p}/`)),
        );
        expect(
          paths.filter((p) => !fs.existsSync(path.join(REPO_ROOT, p))),
        ).toEqual([]);
        expect(titles.some(({ title }) => titled.test(title))).toBe(true);
      } else {
        expect(
          pytestFunctions().filter((name) => name.includes(`_${pytest}_`)),
        ).not.toEqual([]);
      }
    },
  );
});

/** The runner's own verdict on a trial that ended with `status` and `output`. */
function verdictOn(
  runner: "jest" | "pytest",
  status: number,
  output: string,
): Verdict {
  const mutant =
    runner === "jest"
      ? { id: "RX", jest: ["__tests__/x.test.ts"] }
      : { id: "RX", pytest: "rx" };
  const program = [
    `const { verdict } = await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`,
    `const trial = ${JSON.stringify({ status, output })};`,
    `process.stdout.write(JSON.stringify(verdict(${JSON.stringify(mutant)}, trial)));`,
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describe("scripts/mutants.mjs — what counts as a kill", () => {
  const SUITE_DID_NOT_LOAD = [
    "FAIL __tests__/api/booking.test.ts",
    "  ● Test suite failed to run",
    "",
    "    SyntaxError: Unexpected token (12:4)",
    "",
    "Test Suites: 1 failed, 1 total",
    "Tests:       0 total",
  ].join("\n");

  it.each([
    {
      trial: "Jest: an assertion failed",
      runner: "jest" as const,
      status: 1,
      output:
        "Test Suites: 1 failed, 1 total\nTests:       2 failed, 3 passed, 5 total",
      verdict: { status: "killed", detail: "2 test(s) failed" },
    },
    {
      trial: "Jest: every test passed",
      runner: "jest" as const,
      status: 0,
      output: "Test Suites: 1 passed, 1 total\nTests:       5 passed, 5 total",
      verdict: { status: "survived", detail: "its tests pass" },
    },
    {
      trial:
        "Jest: the suite failed to load, which 'Test Suites: 1 failed' also counts",
      runner: "jest" as const,
      status: 1,
      output: SUITE_DID_NOT_LOAD,
      verdict: {
        status: "error",
        detail:
          "its tests did not run: SyntaxError: Unexpected token (12:4) | Test Suites: 1 failed, 1 total | Tests:       0 total",
      },
    },
    {
      trial: "Jest: one suite failed to load beside a failing test in another",
      runner: "jest" as const,
      status: 1,
      output: [
        "FAIL __tests__/api/booking.test.ts",
        "  ● Test suite failed to run",
        "    SyntaxError: Unexpected token (12:4)",
        "FAIL __tests__/lib/pricing.test.ts",
        "  ● prices the hour in Zagreb",
        "Test Suites: 2 failed, 2 total",
        "Tests:       1 failed, 4 passed, 5 total",
      ].join("\n"),
      verdict: {
        status: "error",
        detail:
          "its tests did not run: ● prices the hour in Zagreb | Test Suites: 2 failed, 2 total | Tests:       1 failed, 4 passed, 5 total",
      },
    },
    {
      trial: "Jest: it crashed before reporting",
      runner: "jest" as const,
      status: 1,
      output: "Error: Cannot find module 'jest-expo/node'",
      verdict: {
        status: "error",
        detail: "Error: Cannot find module 'jest-expo/node'",
      },
    },
    {
      trial: "pytest: an assertion failed",
      runner: "pytest" as const,
      status: 1,
      output: "F.F\n2 failed, 1 passed, 40 deselected in 0.52s",
      verdict: { status: "killed", detail: "2 test(s) failed" },
    },
    {
      trial: "pytest: a module failed to collect",
      runner: "pytest" as const,
      status: 2,
      output: "ERROR tests/test_features.py\n1 failed, 1 error in 0.31s",
      verdict: {
        status: "error",
        detail:
          "its tests did not run: ERROR tests/test_features.py | 1 failed, 1 error in 0.31s",
      },
    },
    {
      trial: "pytest: every test passed",
      runner: "pytest" as const,
      status: 0,
      output: "3 passed, 40 deselected in 0.40s",
      verdict: { status: "survived", detail: "its tests pass" },
    },
  ])("C3: $trial → $verdict.status", ({ runner, status, output, verdict }) => {
    expect(verdictOn(runner, status, output)).toEqual(verdict);
  });
});

/**
 * A stub for node_modules/jest/bin/jest.js: it logs its arguments, what the
 * two target files held while it ran and its pid, then does what STUB_JEST says.
 */
const STUB_JEST = `
const fs = require("fs");
const run = {
  argv: process.argv.slice(2),
  x: fs.readFileSync("lib/x.ts", "utf8"),
  y: fs.readFileSync("lib/y.ts", "utf8"),
  pid: process.pid,
};
fs.appendFileSync("stub-runs.log", JSON.stringify(run) + "\\n");
const fail = () => {
  process.stderr.write("Tests:       2 failed, 1 passed, 3 total\\n");
  process.exitCode = 1;
};
const mode = process.env.STUB_JEST;
if (mode === "fail") fail();
if (mode === "hang") setTimeout(() => {}, 60000);
// Holds the trial open until the test has signalled the runner, then fails.
if (mode === "gated") {
  const wait = () => (fs.existsSync("release") ? fail() : setTimeout(wait, 20));
  wait();
}
if (mode === "sigint") process.kill(process.pid, "SIGINT");
`;
const TARGET = "lib/x.ts";
const ORIGINAL = "export const a = 1;\n";
const MUTATED = "export const a = 2;\n";
const FIRST = {
  id: "RX",
  bug: "a is 2",
  file: TARGET,
  find: "a = 1",
  replace: "a = 2",
  jest: ["__tests__/x.test.ts"],
};
const SECOND = { ...FIRST, id: "RY", bug: "b is 2", file: "lib/y.ts" };
/** Where the runner keeps its backup: inside the scratch repo. */
const BACKUP_DIR = ".mutants-backup";

describe("npm run mutants, in a scratch repo with a stub Jest", () => {
  let sandbox: string;
  let stubPid: number | null;
  const inSandbox = (file: string) => path.join(sandbox, file);
  const readSandbox = (file: string) =>
    fs.readFileSync(inSandbox(file), "utf8");
  const stubRuns = () =>
    readSandbox("stub-runs.log")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

  const env = (mode: string, extra: Record<string, string> = {}) => ({
    ...process.env,
    STUB_JEST: mode,
    MUTANTS_BACKUP_DIR: inSandbox(BACKUP_DIR),
    ...extra,
  });
  const runMutants = (mode: string, extra?: Record<string, string>) =>
    spawnSync(process.execPath, [inSandbox("scripts/mutants.mjs")], {
      cwd: sandbox,
      env: env(mode, extra),
      encoding: "utf8",
    });
  const startMutants = (mode: string) => {
    const child = spawn(process.execPath, [inSandbox("scripts/mutants.mjs")], {
      cwd: sandbox,
      env: env(mode),
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk) => (stdout += chunk));
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    const exited = new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve) =>
      child.on("exit", (code) => resolve({ code, stdout, stderr })),
    );
    return { child, exited };
  };
  /** Resolves once the stub Jest is running, i.e. the mutant is in the tree. */
  async function stubStarted(): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(inSandbox("stub-runs.log"))) {
      if (Date.now() > deadline) throw new Error("the stub Jest never started");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    stubPid = stubRuns()[0].pid;
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const killStub = () => {
    if (stubPid !== null && alive(stubPid)) process.kill(stubPid, "SIGKILL");
  };
  /** Kill the runner outright while its first trial runs, as a crash or kill -9 would. */
  async function crashMidTrial() {
    const run = startMutants("hang");
    await stubStarted();
    run.child.kill("SIGKILL");
    await run.exited;
    killStub(); // Windows ends it with the runner; POSIX leaves it orphaned
  }
  const row = (mutant: typeof FIRST, result: string) =>
    `| ${mutant.id} | ${mutant.bug} | ${result} |`;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "djir-mutants-test-"));
    stubPid = null;
    fs.mkdirSync(inSandbox("scripts"));
    fs.mkdirSync(inSandbox("lib"));
    fs.mkdirSync(inSandbox("node_modules/jest/bin"), { recursive: true });
    fs.writeFileSync(inSandbox("package.json"), '{ "private": true }\n');
    fs.copyFileSync(SCRIPT, inSandbox("scripts/mutants.mjs"));
    fs.writeFileSync(
      inSandbox("scripts/mutants.json"),
      JSON.stringify([FIRST, SECOND]),
    );
    fs.writeFileSync(inSandbox("node_modules/jest/bin/jest.js"), STUB_JEST);
    fs.writeFileSync(inSandbox(TARGET), ORIGINAL);
    fs.writeFileSync(inSandbox("lib/y.ts"), ORIGINAL);
  });

  afterEach(() => {
    killStub();
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("C3: a failed assertion kills the mutant; its tests ran on the mutated file, filtered to its R-id, and the file is restored", () => {
    const result = runMutants("fail");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(row(FIRST, "✅ killed: 2 test(s) failed"));
    expect(result.stdout).toContain(row(SECOND, "✅ killed: 2 test(s) failed"));
    expect(stubRuns()).toEqual([
      {
        argv: ["--ci", "--silent", "__tests__/x.test.ts", "-t", "RX\\b"],
        x: MUTATED,
        y: ORIGINAL,
        pid: expect.any(Number),
      },
      {
        argv: ["--ci", "--silent", "__tests__/x.test.ts", "-t", "RY\\b"],
        x: ORIGINAL,
        y: MUTATED,
        pid: expect.any(Number),
      },
    ]);
    expect(readSandbox(TARGET)).toBe(ORIGINAL);
    expect(readSandbox("lib/y.ts")).toBe(ORIGINAL);
  });

  it("C3: a trial that hangs is stopped at the timeout, reported, and the file restored", () => {
    const result = runMutants("hang", { MUTANT_TIMEOUT_MS: "1500" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      row(FIRST, "❌ error: timed out after 1.5 s"),
    );
    expect(readSandbox(TARGET)).toBe(ORIGINAL);
    expect(alive(stubRuns()[0].pid)).toBe(false);
  });

  it("C3: a run killed outright mid-trial leaves its backup, and the next run restores the file before anything else", async () => {
    await crashMidTrial();
    expect(readSandbox(TARGET)).toBe(MUTATED);
    expect(fs.readdirSync(inSandbox(BACKUP_DIR))).toEqual(["backup.json"]);

    const next = runMutants("fail");

    expect(next.stderr).toContain(
      "Restored lib/x.ts from an interrupted earlier run.",
    );
    expect(next.stdout).toContain(row(FIRST, "✅ killed: 2 test(s) failed"));
    expect(next.status).toBe(0);
    expect(readSandbox(TARGET)).toBe(ORIGINAL);
    expect(fs.existsSync(inSandbox(BACKUP_DIR))).toBe(false);
  });

  it("C3: a file edited after a crash is not overwritten by the restore, and its backup is kept", async () => {
    await crashMidTrial();
    fs.writeFileSync(inSandbox(TARGET), "export const a = 3;\n");

    const next = runMutants("fail");

    expect(next.status).not.toBe(0);
    expect(next.stderr).toContain(
      "lib/x.ts changed after a mutant went in; its original is in",
    );
    expect(next.stdout).not.toContain("| RX |");
    expect(readSandbox(TARGET)).toBe("export const a = 3;\n");
    expect(fs.readdirSync(inSandbox(BACKUP_DIR))).toEqual(["backup.json"]);
  });

  // Windows cannot deliver a catchable SIGINT or SIGTERM to another process:
  // there a kill is always forced, and the restore-on-start test above covers
  // it. These run on the ubuntu CI job.
  const SIGNAL_ROUTES =
    process.platform === "win32"
      ? []
      : [
          {
            route: "SIGTERM reaches the runner mid-trial",
            mode: "gated",
            // The signal is pending in the runner before its trial may end, so
            // the order never depends on how fast the machine is.
            send: (child: ChildProcess) => {
              child.kill("SIGTERM");
              fs.writeFileSync(inSandbox("release"), "");
            },
            code: 143,
            firstRow: row(FIRST, "✅ killed: 2 test(s) failed"),
            message: "SIGTERM: stopped; no mutant is left in the tree.",
          },
          {
            route: "its tests die of Ctrl+C (SIGINT reaches the whole group)",
            mode: "sigint",
            send: () => {},
            code: 130,
            firstRow: null,
            message:
              "SIGINT: stopped, lib/x.ts restored; no mutant is left in the tree.",
          },
        ];
  for (const { route, mode, send, code, firstRow, message } of SIGNAL_ROUTES) {
    it(`C3: when ${route}, the run stops with the file restored and no later mutant tried`, async () => {
      const run = startMutants(mode);
      await stubStarted();
      send(run.child);
      const { code: exitCode, stdout, stderr } = await run.exited;

      expect(exitCode).toBe(code);
      expect(stderr).toContain(message);
      if (firstRow) expect(stdout).toContain(firstRow);
      expect(stdout).not.toContain("| RY |");
      expect(readSandbox(TARGET)).toBe(ORIGINAL);
      expect(readSandbox("lib/y.ts")).toBe(ORIGINAL);
    });
  }
});
