/**
 * Red → green evidence for the review's critical findings (BUILD_PLAN §2, C3).
 *
 * Each mutant in scripts/mutants.json puts one v1.0 bug back into the v1.1
 * code, runs only the tests titled with that R-id, and expects an assertion to
 * FAIL (the mutant is "killed"). A mutant whose tests still pass, whose tests
 * could not even load, or whose target code has moved fails the run
 * (__tests__/meta/mutants.test.ts keeps the targets from going stale).
 *
 * The original file is copied to a backup in the temp dir before it is
 * touched, and put back after the trial, on exit, on SIGINT/SIGTERM, and — if
 * a previous run was killed outright — when the next run starts.
 *
 *   npm run mutants            # all
 *   npm run mutants -- R04 R05 # some
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MUTANTS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/mutants.json"), "utf8"),
);
/**
 * One backup slot per checkout, so two clones never restore each other
 * (MUTANTS_BACKUP_DIR moves it, e.g. into a test's scratch directory).
 */
const BACKUP = path.join(
  process.env.MUTANTS_BACKUP_DIR ??
    path.join(
      os.tmpdir(),
      "djir-mutants",
      createHash("sha1").update(ROOT).digest("hex").slice(0, 12),
    ),
  "backup.json",
);
const TRIAL_TIMEOUT_MS = Number(process.env.MUTANT_TIMEOUT_MS ?? 10 * 60_000);
const JEST = [
  "--experimental-vm-modules",
  "node_modules/jest/bin/jest.js",
  "--ci",
  "--silent",
];
const PYTHON =
  ["ml-platform/.venv/Scripts/python.exe", "ml-platform/.venv/bin/python"]
    .map((p) => path.join(ROOT, p))
    .find((p) => fs.existsSync(p)) ??
  (process.platform === "win32" ? "python" : "python3");

const readIfExists = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;

/** Save `file`'s original (null: it does not exist) before it is mutated. */
function backUp(file, original, mutated) {
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  const partial = `${BACKUP}.partial`;
  fs.writeFileSync(partial, JSON.stringify({ file, original, mutated }));
  fs.renameSync(partial, BACKUP); // atomic: a backup is whole or absent
}

/**
 * Put the backed-up file back, if there is one; returns its path. A file that
 * was edited after the mutant went in is left alone, and so is the backup.
 */
function restore() {
  if (!fs.existsSync(BACKUP)) return null;
  const { file, original, mutated } = JSON.parse(
    fs.readFileSync(BACKUP, "utf8"),
  );
  const absolute = path.join(ROOT, file);
  const current = readIfExists(absolute);
  if (current !== original && current !== mutated) {
    throw new Error(
      `${file} changed after a mutant went in; its original is in ${BACKUP}. Put it back by hand, then delete that file.`,
    );
  }
  if (original === null) {
    fs.rmSync(absolute, { force: true });
    const dir = path.dirname(absolute);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0)
      fs.rmdirSync(dir);
  } else if (current !== original) {
    fs.writeFileSync(absolute, original);
  }
  fs.rmSync(BACKUP);
  if (fs.readdirSync(path.dirname(BACKUP)).length === 0)
    fs.rmdirSync(path.dirname(BACKUP));
  return file;
}

/** The tests of the trial in progress, so a signal can stop them too. */
let running = null;

/** Stop the run at once, with every file as it was. */
function interrupt(signal) {
  running?.kill("SIGKILL");
  const file = restore();
  console.error(
    `\n${signal}: stopped${file ? `, ${file} restored` : ""}; no mutant is left in the tree.`,
  );
  process.exit(128 + (os.constants.signals[signal] ?? 2));
}

/**
 * Killed only when an assertion failed: Jest's `Tests: N failed` with no
 * suite that failed to run, or pytest's `N failed` with no errors.
 */
export function verdict(mutant, { status, output }) {
  const failed = Number(
    (mutant.jest
      ? /^Tests:\s+(\d+) failed/m.exec(output)
      : /\b(\d+) failed\b/.exec(output))?.[1] ?? 0,
  );
  const broken = mutant.jest
    ? /Test suite failed to run/.test(output)
    : /\b\d+ errors?\b/.test(output);
  if (status === 0) return { status: "survived", detail: "its tests pass" };
  if (failed >= 1 && !broken)
    return { status: "killed", detail: `${failed} test(s) failed` };
  const tail = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" | ");
  return {
    status: "error",
    detail: broken ? `its tests did not run: ${tail}` : tail,
  };
}

/**
 * Run the mutant's tests. Asynchronously, so the event loop keeps running: a
 * SIGINT or SIGTERM is handled the moment it arrives, not after the trial.
 */
function run(mutant) {
  const [command, args, cwd] = mutant.jest
    ? [
        process.execPath,
        [...JEST, ...mutant.jest, "-t", `${mutant.id}\\b`],
        ROOT,
      ]
    : [
        PYTHON,
        ["-m", "pytest", "-q", "-k", mutant.pytest],
        path.join(ROOT, "ml-platform"),
      ];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    running = child;
    let output = "";
    let timedOut = false;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running = null;
      resolve({ ...result, output, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TRIAL_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => settle({ error }));
    child.on("close", (status, signal) => settle({ status, signal }));
  });
}

/** Apply the mutant, run its tests, always restore. */
async function trial(mutant) {
  const file = path.join(ROOT, mutant.file);
  const original = readIfExists(file);
  let mutated;
  if (mutant.create) {
    if (original !== null)
      return { status: "stale", detail: "file already exists" };
    mutated = mutant.create;
  } else {
    const hits = original === null ? 0 : original.split(mutant.find).length - 1;
    if (hits !== 1)
      return { status: "stale", detail: `target found ${hits}× (expected 1)` };
    mutated = original.replace(mutant.find, () => mutant.replace);
  }
  backUp(mutant.file, original, mutated);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, mutated);
    const result = await run(mutant);
    if (result.timedOut)
      return {
        status: "error",
        detail: `timed out after ${TRIAL_TIMEOUT_MS / 1000} s`,
      };
    if (result.error) return { status: "error", detail: result.error.message };
    // Ctrl+C reaches the whole process group: the tests died of it, so stop.
    if (result.signal === "SIGINT" || result.signal === "SIGTERM")
      interrupt(result.signal);
    return verdict(mutant, { status: result.status, output: result.output });
  } finally {
    restore();
  }
}

async function main() {
  const leftover = restore();
  if (leftover)
    console.error(`Restored ${leftover} from an interrupted earlier run.`);
  process.on("exit", restore);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"])
    process.on(signal, () => interrupt(signal));

  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((id) => !MUTANTS.some((m) => m.id === id));
  if (unknown.length > 0) {
    console.error(`No mutant ${unknown.join(", ")} in scripts/mutants.json`);
    process.exit(2);
  }
  const selected = MUTANTS.filter(
    (m) => wanted.length === 0 || wanted.includes(m.id),
  );
  let ok = true;
  console.log("| R | Reintroduced bug | Result |\n| --- | --- | --- |");
  for (const mutant of selected) {
    const { status, detail } = await trial(mutant);
    ok &&= status === "killed";
    console.log(
      `| ${mutant.id} | ${mutant.bug} | ${status === "killed" ? "✅" : "❌"} ${status}: ${detail} |`,
    );
  }
  process.exit(ok ? 0 : 1);
}

/** Run only as a script: tests import `verdict` without starting a run. */
function invokedDirectly() {
  const script = process.argv[1] && path.resolve(process.argv[1]);
  if (!script || !fs.existsSync(script)) return false;
  const self = fs.realpathSync(fileURLToPath(import.meta.url));
  const invoked = fs.realpathSync(script);
  return process.platform === "win32"
    ? self.toLowerCase() === invoked.toLowerCase()
    : self === invoked;
}

if (invokedDirectly()) await main();
