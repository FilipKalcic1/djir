/**
 * Renders the README's UI images (plan WP6 D4) from docs/gallery/app, a
 * web-only router root that shows the app's real components with fixture data:
 *
 *   1. export the gallery for the web (DJIR_GALLERY=1 switches the root),
 *   2. serve the export on localhost,
 *   3. capture each route with headless Chrome at its frame's size, 2×; a
 *      route that lists animation frames becomes an animated PNG (APNG).
 *
 * Output: docs/images/ui/<route>.png, plus manifest.json: the hash of every
 * input the renders were made from and of every render (see
 * scripts/gallery-inputs.mjs), which __tests__/config/docs-shots.test.ts
 * checks. Needs Chrome, Chromium or Edge (CHROME_PATH overrides the search).
 *   npm run docs:shots
 */
/* eslint-env node */
/* global WebSocket -- Node ≥ 22, or 20 with --experimental-websocket (below) */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { galleryInputs, sha256 } from "./gallery-inputs.mjs";

/** Run only as a script: tests import the helpers without starting a run. */
function invokedDirectly() {
  const script = process.argv[1] && path.resolve(process.argv[1]);
  if (!script || !fs.existsSync(script)) return false;
  const self = fs.realpathSync(fileURLToPath(import.meta.url));
  const invoked = fs.realpathSync(script);
  return process.platform === "win32"
    ? self.toLowerCase() === invoked.toLowerCase()
    : self === invoked;
}

// Node 20 has the WebSocket client (used to drive Chrome) behind a flag.
if (invokedDirectly() && typeof WebSocket === "undefined") {
  const { status } = spawnSync(
    process.execPath,
    ["--experimental-websocket", fileURLToPath(import.meta.url)],
    { stdio: "inherit" },
  );
  process.exit(status ?? 1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "images", "ui");
/** The gallery routes, in README order; each becomes `<route>.png`. */
export const ROUTES = [
  "hero",
  "tracking-arrived",
  "tracking-on-trip",
  "tracking-scheduled",
  "tracking-cancelled",
  "schedule",
  "confirm",
  "success",
  "history",
];

/** Chrome, Chromium or Edge: CHROME_PATH first, then the usual installs. */
function findChrome() {
  const windows = [
    process.env.LOCALAPPDATA, // Chrome installed for this user only
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
  ]
    .filter(Boolean)
    .flatMap((base) => [
      path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(base, "Chromium", "Application", "chrome.exe"),
    ]);
  const candidates = [
    process.env.CHROME_PATH,
    ...windows,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error("No Chrome, Chromium or Edge found; set CHROME_PATH");
  }
  return found;
}

/**
 * Runs a package's CLI script with this Node, without a shell: arguments
 * (temp paths with spaces included) reach it as they are.
 */
function runCli(script, args, env = process.env) {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules", ...script.split("/")), ...args],
    { cwd: ROOT, stdio: "inherit", env },
  );
  if (result.error) throw result.error;
  return result.status;
}

function exportGallery(dir) {
  const major = Number(process.versions.node.split(".")[0]);
  const status = runCli(
    "expo/bin/cli",
    ["export", "-p", "web", "--output-dir", dir, "--clear"],
    {
      ...process.env,
      DJIR_GALLERY: "1",
      // Node 25's built-in localStorage breaks expo-notifications' static render.
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        major >= 25 && "--no-experimental-webstorage",
      ]
        .filter(Boolean)
        .join(" "),
    },
  );
  if (status !== 0) throw new Error("expo export failed");
}

/**
 * On the web, NativeWind v2 passes `className` through as CSS classes, so the
 * page needs Tailwind's stylesheet: build it from the gallery's config (the
 * app's, with its content globs — the gallery shows app screens too — and
 * utilities !important; see tailwind.web.config.js). Utilities only:
 * react-native-web brings its own reset.
 */
function buildTailwind(dir) {
  const input = path.join(dir, "tailwind.in.css");
  fs.writeFileSync(input, "@tailwind components;\n@tailwind utilities;\n");
  const status = runCli("tailwindcss/lib/cli.js", [
    "-c",
    "tailwind.web.config.js",
    "-i",
    input,
    "-o",
    path.join(dir, "client", "tailwind.css"),
  ]);
  if (status !== 0) throw new Error("tailwindcss failed");
}

/** Serve the export: pages from server/ (the app uses server output), assets from client/. */
function serve(dir) {
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".json": "application/json",
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const candidates = [
      path.join("client", url),
      path.join("server", `${url}.html`),
      path.join("server", url, "index.html"),
    ];
    const file = candidates
      .map((c) => path.join(dir, c))
      .find(
        (f) => f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile(),
      );
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
    });
    if (file.endsWith(".html")) {
      // After react-native-web's styles, so utilities win at equal specificity.
      const html = fs.readFileSync(file, "utf8");
      res.end(
        html.replace(
          "</head>",
          '<link rel="stylesheet" href="/tailwind.css" /></head>',
        ),
      );
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

/**
 * Headless Chrome, driven over the DevTools protocol so each page gets exactly
 * the viewport asked for. (Chrome's --window-size is clamped to at least 500
 * px wide and loses the browser frame's height, and RideLayout's h-screen and
 * the bottom sheet size themselves from the viewport.)
 */
function launchChrome(binary, profile) {
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  return connectToChrome(child);
}

/** Chrome's DevTools WebSocket URL, as it prints it on start-up. */
function devToolsEndpoint(child, startMs) {
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(new Error(`Chrome did not start:\n${log}`)),
      startMs,
    );
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const url = /DevTools listening on (ws:\/\/\S+)/.exec(log)?.[1];
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (${code}):\n${log}`));
    });
  });
}

/**
 * Connects to a started Chrome `child`. If it does not print its DevTools URL
 * within `startMs`, or the socket fails, Chrome is killed before the error is
 * thrown: left running, it would outlive the script and, on Windows, keep its
 * profile directory locked.
 */
export async function connectToChrome(child, { startMs = 30_000 } = {}) {
  let ws;
  try {
    const endpoint = await devToolsEndpoint(child, startMs);
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () =>
        reject(new Error(`Could not connect to Chrome at ${endpoint}`));
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  let lastId = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => {
    const id = ++lastId;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) =>
      pending.set(id, { resolve, reject }),
    );
  };
  return {
    send,
    close: async () => {
      await send("Browser.close").catch(() => {});
      ws.close();
      child.kill();
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens `url` in a new tab with a `width` × `height` viewport at 2×, waits
 * until the gallery frame has reported its size and every font and image has
 * loaded, lets animations settle, and hands the tab to `use`.
 */
async function withPage(browser, url, { width, height }, use) {
  const { targetId } = await browser.send("Target.createTarget", {
    url: "about:blank",
  });
  try {
    const { sessionId } = await browser.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const call = (method, params) => browser.send(method, params, sessionId);
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await call("Page.navigate", { url });
    const ready = `(() => {
      const { shotWidth, shotHeight, shotFrames } = document.body?.dataset ?? {};
      const loaded =
        document.fonts.status === "loaded" &&
        [...document.images].every((image) => image.complete);
      return shotWidth && shotHeight && loaded
        ? {
            width: Number(shotWidth),
            height: Number(shotHeight),
            frames: shotFrames ? JSON.parse(shotFrames) : null,
          }
        : null;
    })()`;
    for (let waited = 0; ; waited += 250) {
      const { result } = await call("Runtime.evaluate", {
        expression: ready,
        returnByValue: true,
      });
      if (result.value) {
        await sleep(1500); // the bottom sheet slides in; modals fade in
        return await use(call, result.value);
      }
      if (waited > 30_000) {
        throw new Error(`${url} did not render (no frame size after 30 s)`);
      }
      await sleep(250);
    }
  } finally {
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/** CRC-32 of PNG chunks (zlib.crc32 needs Node 22.2). */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** A PNG's IHDR and its image data (every IDAT chunk, joined). */
function readPng(png) {
  let ihdr;
  const idat = [];
  for (let at = PNG_SIGNATURE.length; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }
  return { ihdr, idat: Buffer.concat(idat) };
}

const u32 = (...values) => {
  const buffer = Buffer.alloc(4 * values.length);
  values.forEach((value, i) => buffer.writeUInt32BE(value, 4 * i));
  return buffer;
};

/**
 * An animated PNG: `still` is what viewers without APNG support show (and
 * not part of the animation); `frames` loop forever, each for its `ms`.
 * All screenshots of one frame size share an IHDR, so their image data is
 * copied as it is.
 */
function animatedPng(still, frames) {
  const base = readPng(still);
  const width = base.ihdr.readUInt32BE(0);
  const height = base.ihdr.readUInt32BE(4);
  const chunks = [
    pngChunk("IHDR", base.ihdr),
    pngChunk("acTL", u32(frames.length, 0)),
    pngChunk("IDAT", base.idat),
  ];
  let sequence = 0;
  for (const { png, ms } of frames) {
    const frame = readPng(png);
    if (!frame.ihdr.equals(base.ihdr)) {
      throw new Error("Animation frames differ in size or colour type");
    }
    const control = Buffer.concat([
      u32(sequence++, width, height, 0, 0),
      Buffer.from([ms >> 8, ms & 0xff, 1000 >> 8, 1000 & 0xff, 0, 0]),
    ]);
    chunks.push(pngChunk("fcTL", control));
    chunks.push(pngChunk("fdAT", Buffer.concat([u32(sequence++), frame.idat])));
  }
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

/**
 * Removes the temp dirs. One that will not go (Chrome still holding its
 * profile, say) is reported, never thrown: an exception here would replace
 * the error that ended the run.
 */
export function removeTemps(
  dirs,
  remove = (dir) =>
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }),
) {
  for (const dir of dirs) {
    try {
      remove(dir);
    } catch (error) {
      console.warn(`Could not remove ${dir}: ${error.message}`);
    }
  }
}

/** docs/images/ui/manifest.json: what the renders were made from, and each render. */
function writeManifest(inputs) {
  const manifest = {
    about:
      "Written by npm run docs:shots. __tests__/config/docs-shots.test.ts fails when an input or a render no longer matches: re-run the script.",
    inputs,
    renders: Object.fromEntries(
      ROUTES.map((route) => [
        `${route}.png`,
        sha256(fs.readFileSync(path.join(OUT, `${route}.png`))),
      ]),
    ),
  };
  fs.writeFileSync(
    path.join(OUT, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function main() {
  const binary = findChrome();
  // Hashed before the export: an edit made during the run shows up as stale.
  const inputs = galleryInputs(ROOT);
  const temps = [];
  const tempDir = (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temps.push(dir);
    return dir;
  };
  let server;
  let browser;
  try {
    const dist = tempDir("djir-gallery-");
    const profile = tempDir("djir-chrome-");
    exportGallery(dist);
    buildTailwind(dist);
    server = await serve(dist);
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await launchChrome(binary, profile);
    fs.mkdirSync(OUT, { recursive: true });
    for (const route of ROUTES) {
      const url = `${origin}/${route}`;
      // Measure the frame, then load it again in a viewport of exactly that size.
      const { frames, ...size } = await withPage(
        browser,
        url,
        { width: 1200, height: 1200 },
        async (_, frame) => frame,
      );
      const capture = (pageUrl) =>
        withPage(browser, pageUrl, size, async (call) => {
          const { data } = await call("Page.captureScreenshot", {
            format: "png",
          });
          return Buffer.from(data, "base64");
        });
      let png = await capture(url);
      // A route that lists frames (query + duration) becomes an animated PNG.
      if (frames) {
        const shots = [];
        for (const { query, ms } of frames) {
          shots.push({ png: await capture(`${url}?${query}`), ms });
        }
        png = animatedPng(png, shots);
      }
      fs.writeFileSync(path.join(OUT, `${route}.png`), png);
      console.log(
        `${route}.png  ${size.width}×${size.height}` +
          (frames ? `, ${frames.length} frames` : ""),
      );
    }
    writeManifest(inputs);
  } finally {
    await browser?.close();
    server?.close();
    await sleep(500); // let Chrome release its profile before it is removed
    removeTemps(temps);
  }
}

if (invokedDirectly()) await main();
