/**
 * The README only claims what a test backs (plan §2 C5, WP6 D1–D2, R24, R32,
 * R61). Each claim sentence carries `<!-- claim:Bn -->`; Appendix B says which
 * test backs claim Bn; this file checks the anchors, that each backing
 * reference names a real test (a describe/it/test title in that file, a pytest
 * function, an npm script or a file), and the README's images.
 */
import fs from "fs";
import path from "path";

import {
  jestTitles,
  pytestFunctions,
  read,
  REPO_ROOT,
  resolveTitle,
  section,
  tableRows,
} from "../helpers/plan";

const readme = read("README.md");
const register = tableRows(
  section(read("docs/BUILD_PLAN.md"), "## Appendix B"),
).filter((cells) => /^B\d+$/.test(cells[0]));
const anchors = [...readme.matchAll(/<!-- claim:(B\d+) -->/g)].map((m) => m[1]);

describe("README ↔ Appendix B", () => {
  it("D2: every anchor names a row of the register", () => {
    const known = register.map((cells) => cells[0]);
    expect(anchors.filter((id) => !known.includes(id))).toEqual([]);
  });

  it("D2: every row of the register is claimed somewhere in the README", () => {
    expect(
      register.map((cells) => cells[0]).filter((id) => !anchors.includes(id)),
    ).toEqual([]);
  });

  it("D2 R24 C5: every prose sentence with a euro amount, a percentage, or 'exactly', 'every' or 'verified' is anchored", () => {
    const prose = readme
      .replace(/```[\s\S]*?```/g, "") // code blocks
      .replace(/<table>[\s\S]*?<\/table>/g, "") // galleries
      .split("\n")
      .filter((line) => !/^\s*(\||#|!\[|\[!\[|<)/.test(line)); // tables, headings, images, badges
    const unanchored = prose.filter(
      (line) =>
        /(€\s?\d|\d\s?%|\bexactly\b|\bevery\b|\bverified\b)/i.test(line) &&
        !line.includes("<!-- claim:"),
    );
    expect(unanchored).toEqual([]);
  });
});

describe("Appendix B: each claim's backing test exists", () => {
  const pytest = new Set(pytestFunctions());
  const titles = jestTitles();
  const scripts = JSON.parse(read("package.json")).scripts as Record<
    string,
    string
  >;

  it.each(register.map((cells) => [cells[0], cells[2]]))(
    "%s: %s",
    (_, backedBy) => {
      const refs = [...backedBy.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        if (ref.includes(" › ")) {
          // A real describe/it/test title in that file ("…" ends a prefix),
          // never just the words somewhere in the file.
          expect({
            ref,
            titled: resolveTitle(ref, titles) !== undefined,
          }).toEqual({ ref, titled: true });
        } else if (/^test_\w+$/.test(ref)) {
          expect({ ref, exists: pytest.has(ref) }).toEqual({
            ref,
            exists: true,
          });
        } else if (/^npm run (\S+)$/.test(ref)) {
          expect(scripts).toHaveProperty(ref.slice("npm run ".length));
        } else if (/[/.]/.test(ref)) {
          expect({
            ref,
            exists: fs.existsSync(path.join(REPO_ROOT, ref)),
          }).toEqual({ ref, exists: true });
        }
      }
    },
  );
});

describe("README images (D1, R32, R61)", () => {
  const images = [
    ...[...readme.matchAll(/<img\s[^>]*>/g)].map((m) => ({
      src: /src="([^"]+)"/.exec(m[0])?.[1] ?? "",
      alt: /alt="([^"]*)"/.exec(m[0])?.[1] ?? "",
    })),
    ...[...readme.matchAll(/(?<!\[)!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((m) => ({
      src: m[2],
      alt: m[1],
    })),
  ].filter(({ src }) => !/^https?:/.test(src));

  it("finds the gallery, the renders and the chart", () => {
    expect(images.length).toBeGreaterThan(10);
  });

  it.each(images.map(({ src, alt }) => [src, alt]))(
    "D1: %s exists and has alt text",
    (src, alt) => {
      expect(fs.existsSync(path.join(REPO_ROOT, decodeURI(src)))).toBe(true);
      expect(alt.trim()).not.toBe("");
    },
  );

  it("R61: gallery rows are full (no empty cells)", () => {
    expect(readme).not.toMatch(/<td[^>]*>\s*<\/td>/);
  });

  it("R32: the Figma screens are captioned as design, not as the built app", () => {
    const gallery = section(readme, "## 🎨 Design");
    expect(gallery).toMatch(/Figma/);
    expect(gallery).toMatch(/design/i);
  });
});
