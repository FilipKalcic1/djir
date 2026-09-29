/** The repository on disk, for tests that read its files (meta, config, schema). */
import fs from "fs";
import path from "path";

export const REPO_ROOT = path.resolve(__dirname, "../..");

/** The repo file at `relative`, as text. */
export const read = (relative: string) =>
  fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");

/**
 * Repo-relative paths (forward slashes) of the files under `dir` whose name
 * matches `pattern` (every file by default); none when `dir` does not exist.
 */
export function filesUnder(dir: string, pattern: RegExp = /(?:)/): string[] {
  const absolute = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(relative, pattern);
    return pattern.test(entry.name) ? [relative] : [];
  });
}
