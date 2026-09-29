/**
 * `npm run docs:shots` (plan WP6 D4): the README renders in docs/images/ui are
 * the files the script last wrote, made from the gallery inputs as they are
 * today, and a failed Chrome start never leaves Chrome running. The scripts
 * are ES modules, so each check runs in a child Node that imports them.
 */
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

import { read, REPO_ROOT } from "../helpers/repo";

jest.setTimeout(60_000);

const moduleUrl = (file: string) =>
  JSON.stringify(pathToFileURL(path.join(REPO_ROOT, file)).href);
const SHOTS = moduleUrl("scripts/docs-shots.mjs");
const INPUTS = moduleUrl("scripts/gallery-inputs.mjs");
const UI = "docs/images/ui";

/** Runs `program` as an ES module in a child Node; returns the JSON it printed. */
function runModule(program: string) {
  const major = Number(process.versions.node.split(".")[0]);
  const result = spawnSync(
    process.execPath,
    [
      // Node 20 has the WebSocket client behind a flag, as docs-shots.mjs knows.
      ...(major < 22 ? ["--experimental-websocket"] : []),
      "--input-type=module",
      "-e",
      program,
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

type Manifest = {
  inputs: Record<string, string>;
  renders: Record<string, string>;
};
const manifest = (): Manifest => JSON.parse(read(`${UI}/manifest.json`));

describe("the README renders", () => {
  it("D4: were made from the gallery inputs as they are today (if not, re-run npm run docs:shots)", () => {
    const inputs = runModule(
      `import { galleryInputs } from ${INPUTS};
       process.stdout.write(JSON.stringify(galleryInputs(${JSON.stringify(REPO_ROOT)})));`,
    );

    expect(inputs).toEqual(manifest().inputs);
  });

  it("D4: are the files npm run docs:shots wrote, one per gallery route: none was edited by hand", () => {
    const { routes } = runModule(
      `import { ROUTES } from ${SHOTS};
       process.stdout.write(JSON.stringify({ routes: ROUTES }));`,
    );
    const galleryRoutes = fs
      .readdirSync(path.join(REPO_ROOT, "docs/gallery/app"))
      .filter((file) => file !== "_layout.tsx")
      .map((file) => file.replace(/\.tsx$/, ""));
    const renders = fs
      .readdirSync(path.join(REPO_ROOT, UI))
      .filter((file) => file.endsWith(".png"));

    expect([...routes].sort()).toEqual(galleryRoutes.sort());
    expect(Object.keys(manifest().renders)).toEqual(
      routes.map((route: string) => `${route}.png`),
    );
    expect(
      Object.fromEntries(
        renders.map((file) => [
          file,
          sha256(fs.readFileSync(path.join(REPO_ROOT, UI, file))),
        ]),
      ),
    ).toEqual(manifest().renders);
  });
});

describe("galleryInputs, in a scratch repo", () => {
  let root: string;
  const write = (file: string, content: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const inputsOf = (dir: string) =>
    runModule(
      `import { galleryInputs } from ${INPUTS};
       try {
         process.stdout.write(JSON.stringify({ inputs: galleryInputs(${JSON.stringify(dir)}) }));
       } catch (error) {
         process.stdout.write(JSON.stringify({ error: error.message }));
       }`,
    );
  const ICON = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "djir-gallery-inputs-"));
    write(
      "docs/gallery/app/route.tsx",
      [
        'import { View } from "react-native";',
        "",
        'import Card from "@/components/Card";',
        '// import Old from "@/components/Old";',
        "",
        'import { label } from "../label";',
        "",
        'const icon = require("@/assets/icon.png");',
        "",
      ].join("\n"),
    );
    write("docs/gallery/label.ts", 'export const label = "x";\r\n');
    write("components/Card.tsx", "export default function Card() {}\n");
    write(
      "components/Card.web.tsx",
      'import { km } from "@/lib/geo";\n\nexport default km;\n',
    );
    write("components/Unused.tsx", "export default 1;\n");
    write(
      "lib/geo.ts",
      'import { label } from "../docs/gallery/label";\n\nexport const km = label;\n',
    );
    write("assets/icon.png", ICON);
    write("tailwind.config.js", "module.exports = {};\n");
    write(
      "tailwind.web.config.js",
      'module.exports = require("./tailwind.config.js");\n',
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("D4: follows the gallery's repo imports as the web export resolves them (X.web.tsx before X.tsx), through cycles, and nothing else", () => {
    const { inputs } = inputsOf(root);

    expect(Object.keys(inputs)).toEqual([
      "assets/icon.png",
      "components/Card.web.tsx",
      "docs/gallery/app/route.tsx",
      "docs/gallery/label.ts",
      "lib/geo.ts",
      "tailwind.config.js",
      "tailwind.web.config.js",
    ]);
    expect(inputs["assets/icon.png"]).toBe(sha256(ICON));
  });

  it("D4: hashes text with LF line ends, so a CRLF checkout matches an LF one", () => {
    const { inputs } = inputsOf(root);

    expect(inputs["docs/gallery/label.ts"]).toBe(
      sha256('export const label = "x";\n'),
    );
  });

  it("D4: a repo import that resolves to nothing is an error, not a silently missing input", () => {
    write(
      "docs/gallery/app/broken.tsx",
      'import Gone from "@/components/Gone";\n',
    );

    expect(inputsOf(root)).toEqual({
      error: 'docs/gallery/app/broken.tsx: cannot resolve "@/components/Gone"',
    });
  });
});

describe("docs-shots cleans up after itself", () => {
  /** A stand-in Chrome: prints `stderr`, then idles until it is killed. */
  const fakeChrome = (stderr: string) =>
    `spawn(process.execPath, ["-e", ${JSON.stringify(
      `process.stderr.write(${JSON.stringify(stderr)}); setInterval(() => {}, 1000);`,
    )}])`;
  const connect = (chrome: string, options: string) =>
    runModule(
      `import { spawn } from "node:child_process";
       import net from "node:net";
       import { connectToChrome } from ${SHOTS};
       // A port nothing listens on: bound, then released.
       const port = await new Promise((resolve) => {
         const server = net.createServer().listen(0, "127.0.0.1", () => {
           const { port } = server.address();
           server.close(() => resolve(port));
         });
       });
       const chrome = ${chrome.replace("PORT", '" + port + "')};
       const exited = new Promise((resolve) => chrome.on("exit", () => resolve(true)));
       const error = await connectToChrome(chrome, ${options}).then(
         () => null,
         (e) => e.message.replace(String(port), "PORT"),
       );
       const stopped = await Promise.race([
         exited,
         // unref: once Chrome has exited, this timer must not hold the run open.
         new Promise((resolve) => setTimeout(() => resolve(false), 5000).unref()),
       ]);
       if (!stopped) chrome.kill("SIGKILL");
       process.stdout.write(JSON.stringify({ error, stopped }));`,
    );

  it("a Chrome whose DevTools socket refuses the connection is killed before the error is thrown", () => {
    const result = connect(
      fakeChrome(
        "DevTools listening on ws://127.0.0.1:PORT/devtools/browser/x\n",
      ),
      "{}",
    );

    expect(result).toEqual({
      error:
        "Could not connect to Chrome at ws://127.0.0.1:PORT/devtools/browser/x",
      stopped: true,
    });
  });

  it("a Chrome that never prints its DevTools URL is killed when the wait times out", () => {
    const result = connect(fakeChrome(""), "{ startMs: 300 }");

    expect(result).toEqual({ error: "Chrome did not start:\n", stopped: true });
  });

  it("a temp dir that cannot be removed is reported, and the others are still removed", () => {
    const result = runModule(
      `import { removeTemps } from ${SHOTS};
       const warnings = [];
       console.warn = (message) => warnings.push(message);
       const tried = [];
       removeTemps(["profile", "dist"], (dir) => {
         tried.push(dir);
         if (dir === "profile") throw new Error("EBUSY: resource busy or locked");
       });
       process.stdout.write(JSON.stringify({ tried, warnings }));`,
    );

    expect(result).toEqual({
      tried: ["profile", "dist"],
      warnings: ["Could not remove profile: EBUSY: resource busy or locked"],
    });
  });
});
