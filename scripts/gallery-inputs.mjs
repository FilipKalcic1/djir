/**
 * What the README renders are made from (plan WP6 D4): every file under
 * docs/gallery, every repo file those import (followed transitively and
 * resolved as the web export resolves them, `X.web.tsx` before `X.tsx`) and
 * the Tailwind configs the page's stylesheet is built from. npm packages are
 * not followed.
 *
 * `npm run docs:shots` records a hash of each input, and of each render, in
 * docs/images/ui/manifest.json; __tests__/config/docs-shots.test.ts computes
 * them again, so a component change that was not re-rendered, or a render
 * edited by hand, fails the suite.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

const GALLERY = "docs/gallery";
const CONFIGS = ["tailwind.config.js", "tailwind.web.config.js"];
const CODE = /\.[cm]?[jt]sx?$/;
const TEXT = /\.(?:[cm]?[jt]sx?|json|css)$/;
const EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/** Hex SHA-256 of a string or a buffer. */
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Text is hashed with LF line ends, so a CRLF checkout hashes the same. */
function hashFile(file) {
  const bytes = fs.readFileSync(file);
  return sha256(
    TEXT.test(file) ? bytes.toString("utf8").replace(/\r\n/g, "\n") : bytes,
  );
}

const isFile = (file) => fs.existsSync(file) && fs.statSync(file).isFile();

/**
 * The repo file that `specifier`, imported by `fromFile`, names; null for an
 * npm package. A repo import that resolves to nothing is an error, never a
 * silently missing input.
 */
export function resolveImport(root, fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else return null;
  const found = [
    ...EXTENSIONS.map((ext) => `${base}.web.${ext}`),
    ...EXTENSIONS.map((ext) => `${base}.${ext}`),
    `${base}.d.ts`,
    base,
    ...EXTENSIONS.map((ext) => path.join(base, `index.${ext}`)),
  ].find(isFile);
  if (!found) {
    const from = path.relative(root, fromFile).split(path.sep).join("/");
    throw new Error(`${from}: cannot resolve "${specifier}"`);
  }
  return found;
}

function filesUnder(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}

/** `{ repo-relative path: SHA-256 }` for every gallery input, sorted by path. */
export function galleryInputs(root) {
  const seen = new Set();
  const queue = [
    ...filesUnder(path.join(root, GALLERY)),
    ...CONFIGS.map((config) => path.join(root, config)),
  ];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!CODE.test(file)) continue; // images, fonts and JSON import nothing
    const { importedFiles } = ts.preProcessFile(
      fs.readFileSync(file, "utf8"),
      true,
      true,
    );
    for (const { fileName } of importedFiles) {
      const resolved = resolveImport(root, file, fileName);
      if (resolved) queue.push(resolved);
    }
  }
  return Object.fromEntries(
    [...seen]
      .map((file) => [
        path.relative(root, file).split(path.sep).join("/"),
        hashFile(file),
      ])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
