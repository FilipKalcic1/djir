/**
 * Every API route requires a signed-in caller, except an explicit allowlist:
 * the drivers on the map, a price quote, and the setup health check (EG2).
 * The routes are discovered from disk, so a route added later without
 * `requireUserId` fails here — it cannot slip through by not having a test.
 */
import { readdirSync } from "fs";
import { join, relative, sep } from "path";

import { jsonRequest, applyTestAuthEnv } from "../helpers/auth";

const API_DIR = join(__dirname, "..", "..", "app", "(api)");
const PUBLIC = new Set(["GET driver", "POST predict-price", "GET health"]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const routeFiles = (readdirSync(API_DIR, { recursive: true }) as string[])
  .filter((f) => f.endsWith("+api.ts"))
  .map((f) => f.split(sep).join("/"));

const routeName = (file: string) =>
  file.replace(/\+api\.ts$/, "").replace(/\([^)]+\)\//g, "");

beforeAll(applyTestAuthEnv);

describe("R01: API route inventory", () => {
  it("R03 R37: finds the v1.1 routes, and none of the removed ones (pay, user)", () => {
    expect(routeFiles.map(routeName).sort()).toEqual(
      [
        "driver",
        "health",
        "predict-price",
        "ride/book",
        "ride/cancel",
        "ride/confirm",
        "rides",
      ].sort(),
    );
  });

  it.each(routeFiles)(
    "R01 %s: every non-public handler answers 401 without a session",
    async (file) => {
      const route = require(join(API_DIR, file));
      const handlers = METHODS.filter((m) => typeof route[m] === "function");
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        if (PUBLIC.has(`${method} ${routeName(file)}`)) continue;
        const body = method === "GET" ? undefined : {};
        const res: Response = await route[method](
          jsonRequest(`/${routeName(file)}`, body, undefined, method),
          {},
        );
        expect({
          route: `${method} ${relative(API_DIR, join(API_DIR, file))}`,
          status: res.status,
        }).toEqual({
          route: `${method} ${relative(API_DIR, join(API_DIR, file))}`,
          status: 401,
        });
      }
    },
  );
});
