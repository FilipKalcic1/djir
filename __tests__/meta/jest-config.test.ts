/**
 * The Jest setup the rest of the suite leans on (plan WP0 and §9): two
 * projects that together run every test file, the timezone guard in both,
 * the coverage gates, the npm scripts and the CI workflow that runs them.
 * Loosening any of them would quietly weaken every other test, so they are
 * pinned here, and so are the packages the tests import. Globs are matched
 * with jest-util's `globsToMatcher`, the function Jest itself uses.
 */
import fs from "fs";
import { builtinModules } from "module";
import path from "path";

import { globsToMatcher } from "jest-util";
import ts from "typescript";

import { filesUnder, read, REPO_ROOT } from "../helpers/repo";

type Threshold = { lines?: number; branches?: number };
type Project = {
  displayName: string;
  preset: string;
  testMatch: string[];
  setupFilesAfterEnv?: string[];
};
type JestConfig = {
  globalSetup: string;
  projects: Project[];
  collectCoverageFrom: string[];
  coverageThreshold: Record<string, Threshold>;
};

const jestConfig: JestConfig = require("../../jest.config.js");
const pkg = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

const SENTINEL = "__tests__/timezone.sentinel.test.ts";
const SERVER_DIRS = [
  "lib",
  "server",
  "api",
  "db",
  "services",
  "store",
  "config",
  "meta",
];
const CLIENT_DIRS = ["components", "hooks", "screens"];
const GATED_COMPONENTS = [
  "Payment",
  "TrackingSheet",
  "ScheduleModal",
  "RideCard",
  "ActiveRideBanner",
  "RideList",
];

const project = (name: string) => {
  const found = jestConfig.projects.find((p) => p.displayName === name);
  if (!found) throw new Error(`jest.config.js has no "${name}" project`);
  return found;
};

/** Does `p` pick up the repo-relative `file`? */
const runs = (p: Project, file: string) =>
  globsToMatcher(p.testMatch.map((glob) => glob.replace("<rootDir>/", "")))(
    file,
  );

const isCollected = globsToMatcher(jestConfig.collectCoverageFrom);

describe("projects", () => {
  it.each(["server", "client"])(
    "C3: the %s project runs the TZ sentinel",
    (name) => {
      expect(fs.existsSync(path.join(REPO_ROOT, SENTINEL))).toBe(true);

      expect(runs(project(name), SENTINEL)).toBe(true);
    },
  );

  it("the server project runs lib, server, api, db, services, store, config and meta under jest-expo/node", () => {
    const server = project("server");

    expect(server.preset).toBe("jest-expo/node");
    expect(
      SERVER_DIRS.filter((dir) => !runs(server, `__tests__/${dir}/x.test.ts`)),
    ).toEqual([]);
    expect(
      CLIENT_DIRS.filter((dir) => runs(server, `__tests__/${dir}/X.test.tsx`)),
    ).toEqual([]);
  });

  it("the client project runs components, hooks and screens (.ts and .tsx) under jest-expo/ios with RNTL matchers", () => {
    const client = project("client");
    const clientTests = CLIENT_DIRS.flatMap((dir) => [
      `__tests__/${dir}/X.test.ts`,
      `__tests__/${dir}/X.test.tsx`,
    ]);

    expect(client.preset).toBe("jest-expo/ios");
    expect(clientTests.filter((file) => !runs(client, file))).toEqual([]);
    expect(
      SERVER_DIRS.filter((dir) => runs(client, `__tests__/${dir}/x.test.ts`)),
    ).toEqual([]);
    expect(client.setupFilesAfterEnv).toEqual([
      "<rootDir>/__tests__/setup/client.ts",
    ]);
    expect(
      fs.readFileSync(
        path.join(REPO_ROOT, "__tests__/setup/client.ts"),
        "utf8",
      ),
    ).toContain('import "@testing-library/react-native/extend-expect";');
  });

  it("every test file under __tests__ runs in exactly one project, and the sentinel in both", () => {
    const testFiles = filesUnder("__tests__").filter((file) =>
      /\.(test|spec)\.[jt]sx?$/.test(file),
    );

    const misrouted = testFiles
      .map((file) => ({
        file,
        projects: jestConfig.projects
          .filter((p) => runs(p, file))
          .map((p) => p.displayName),
      }))
      .filter(({ file, projects }) =>
        file === SENTINEL ? projects.length !== 2 : projects.length !== 1,
      );

    expect(testFiles).toContain(SENTINEL);
    expect(testFiles).toContain("__tests__/meta/jest-config.test.ts");
    expect(misrouted).toEqual([]);
  });
});

describe("globalSetup", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("C3: points at jest.global-setup.js, which pins TZ to America/Los_Angeles", () => {
    const globalSetup = require(path.join(REPO_ROOT, "jest.global-setup.js"));
    process.env.TZ = "Europe/Zagreb";

    globalSetup();

    expect(jestConfig.globalSetup).toBe("<rootDir>/jest.global-setup.js");
    expect(process.env.TZ).toBe("America/Los_Angeles");
  });
});

describe("coverage gates", () => {
  it("C3: coverageThreshold is exactly plan §9", () => {
    const gatedComponent = { lines: 90, branches: 90 };

    expect(jestConfig.coverageThreshold).toEqual({
      "./lib/": { lines: 100, branches: 95 },
      "./server/": { lines: 100, branches: 95 },
      "./app/**/*+api.ts": { lines: 100, branches: 95 },
      "./hooks/": { lines: 90 },
      "./services/": { lines: 90 },
      "./store/": { lines: 100 },
      "./components/Payment.tsx": gatedComponent,
      "./components/TrackingSheet.tsx": gatedComponent,
      "./components/ScheduleModal.tsx": gatedComponent,
      "./components/RideCard.tsx": gatedComponent,
      "./components/ActiveRideBanner.tsx": gatedComponent,
      "./components/RideList.tsx": gatedComponent,
    });
  });

  it("C3: every gated component exists and is in collectCoverageFrom", () => {
    const files = GATED_COMPONENTS.map((name) => `components/${name}.tsx`);

    expect(
      files.filter((file) => !fs.existsSync(path.join(REPO_ROOT, file))),
    ).toEqual([]);
    expect(files.filter((file) => !isCollected(file))).toEqual([]);
  });

  it("C3: every coverage gate measures at least one collected file (Jest fails a gate it finds no data for)", () => {
    const collected = [
      "lib",
      "server",
      "services",
      "hooks",
      "store",
      "app",
      "components",
    ]
      .flatMap((dir) => filesUnder(dir))
      .filter(isCollected);
    const inGate = (key: string) => {
      const gate = key.replace(/^\.\//, "");
      return /[*?{[]/.test(gate)
        ? globsToMatcher([gate])
        : (file: string) => file.startsWith(gate);
    };

    const emptyGates = Object.keys(jestConfig.coverageThreshold).filter(
      (key) => !collected.some(inGate(key)),
    );

    expect(emptyGates).toEqual([]);
    expect(collected).toEqual(
      expect.arrayContaining([
        "app/(api)/predict-price+api.ts",
        "app/(api)/ride/book+api.ts",
        "store/index.ts",
      ]),
    );
  });

  it("leaves screens and the native maps out of the gates (plan §9 exclusions)", () => {
    const excluded = [
      "app/(root)/track-ride.tsx",
      "app/(root)/book-ride.tsx",
      "app/(auth)/sign-in.tsx",
      "components/Map.tsx",
      "components/TrackingMap.tsx",
    ];

    expect(
      excluded.filter((file) => !fs.existsSync(path.join(REPO_ROOT, file))),
    ).toEqual([]);
    expect(excluded.filter(isCollected)).toEqual([]);
  });
});

describe("npm scripts and Node version (plan WP0)", () => {
  it("runs Jest through node with --experimental-vm-modules, which PGlite's dynamic import needs", () => {
    expect(pkg.scripts.test).toBe(
      "node --experimental-vm-modules node_modules/jest/bin/jest.js",
    );
  });

  it("test:coverage is the same Jest launch with --coverage", () => {
    expect(pkg.scripts["test:coverage"]).toMatch(
      /^(npm test -- |node --experimental-vm-modules node_modules\/jest\/bin\/jest\.js )--coverage\b/,
    );
  });

  it("check runs typecheck, then lint, then the tests with coverage", () => {
    expect(pkg.scripts).toMatchObject({
      typecheck: "tsc --noEmit",
      lint: "expo lint",
      check: "npm run typecheck && npm run lint && npm run test:coverage",
    });
  });

  it("requires Node 20 or later, and .nvmrc pins CI to 20", () => {
    expect(pkg.engines).toEqual({ node: ">=20" });
    expect(fs.readFileSync(path.join(REPO_ROOT, ".nvmrc"), "utf8").trim()).toBe(
      "20",
    );
  });

  it("C6: every npm package a test or a script imports is declared in package.json, not only hoisted there by another package", () => {
    const declared = new Set([
      ...Object.keys(pkg.dependencies),
      ...Object.keys(pkg.devDependencies),
    ]);
    const files = [
      ...filesUnder("__tests__", /\.[jt]sx?$/),
      ...filesUnder("scripts", /\.m?js$/),
    ];
    const packageOf = (specifier: string) =>
      specifier
        .split("/")
        .slice(0, specifier.startsWith("@") ? 2 : 1)
        .join("/");

    const undeclared = files.flatMap((file) =>
      ts
        .preProcessFile(read(file), true, true)
        .importedFiles.map(({ fileName }) => fileName)
        .filter((specifier) => !/^(\.|@\/|node:)/.test(specifier))
        .map(packageOf)
        .filter((name) => !builtinModules.includes(name))
        .filter((name) => !declared.has(name))
        .map((name) => `${file}: ${name}`),
    );

    expect(files).toEqual(
      expect.arrayContaining([
        "__tests__/meta/jest-config.test.ts",
        "scripts/gallery-inputs.mjs",
      ]),
    );
    expect(undeclared).toEqual([]);
  });
});

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
};
type Job = {
  "timeout-minutes"?: number;
  "runs-on": string;
  strategy?: { matrix: { os: string[] } };
  defaults?: { run: { "working-directory": string } };
  env?: Record<string, string>;
  steps: Step[];
};

describe("the CI workflow (plan §9, .github/workflows/ci.yml)", () => {
  // js-yaml, a declared devDependency (the version ESLint also uses), ships without types.
  const yaml: { load(text: string): unknown } = require("js-yaml");
  const workflow = yaml.load(read(".github/workflows/ci.yml")) as {
    permissions: unknown;
    jobs: Record<string, Job>;
  };
  const { app, ml, serving } = workflow.jobs;
  const runs = (job: Job) =>
    job.steps.filter((step) => step.run).map((step) => step.run!.trim());

  it("C6: its token can only read the repository", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("C6: every job gives up after 20 minutes, so a hung test cannot run for the 6-hour default", () => {
    expect(
      Object.fromEntries(
        Object.entries(workflow.jobs).map(([name, job]) => [
          name,
          job["timeout-minutes"],
        ]),
      ),
    ).toEqual({ app: 20, ml: 20, serving: 20 });
  });

  it("C6: the app job's Node is the one .nvmrc pins, with the npm cache", () => {
    const node = app.steps.filter((step) =>
      step.uses?.startsWith("actions/setup-node"),
    );

    expect(node).toEqual([
      {
        uses: "actions/setup-node@v4",
        with: { "node-version-file": ".nvmrc", cache: "npm" },
      },
    ]);
  });

  it("C6: the app job runs npm ci, the Expo SDK dependency check (ubuntu), npm run check and the web export, on ubuntu and windows", () => {
    expect(app.strategy?.matrix.os).toEqual([
      "ubuntu-latest",
      "windows-latest",
    ]);
    expect(
      app.steps
        .filter((step) => step.run)
        .map((step) => ({ run: step.run, if: step.if })),
    ).toEqual([
      { run: "npm ci", if: undefined },
      { run: "npx expo install --check", if: "runner.os == 'Linux'" },
      { run: "npm run check", if: undefined },
      {
        run: "npm run web:css && npx expo export -p web",
        if: "runner.os == 'Linux'",
      },
    ]);
  });

  it("C6: the ml job runs pytest in ml-platform on Python 3.12, with the machine in America/Los_Angeles", () => {
    const python = ml.steps.find((step) =>
      step.uses?.startsWith("actions/setup-python"),
    );

    expect(ml["runs-on"]).toBe("ubuntu-latest");
    expect(ml.defaults?.run["working-directory"]).toBe("ml-platform");
    expect(ml.env).toEqual({ TZ: "America/Los_Angeles" });
    expect(python?.with?.["python-version"]).toBe("3.12");
    expect(runs(ml)).toEqual(["pip install -r requirements-dev.txt", "pytest"]);
  });

  it("C6: the serving job builds the ML README's container and requires its models loaded, a non-root process and a healthy HEALTHCHECK", () => {
    const dockerfile = read("ml-platform/serving/Dockerfile");
    const uid = /useradd --system --uid (\d+) djir/.exec(dockerfile)?.[1];
    const [build, start, health, healthcheck, logs] = runs(serving);

    expect(serving["runs-on"]).toBe("ubuntu-latest");
    expect(serving.defaults?.run["working-directory"]).toBe("ml-platform");
    expect(read("ml-platform/README.md")).toContain(
      "docker build -f serving/Dockerfile -t djir-pricing .",
    );
    expect(build).toBe("docker build -f serving/Dockerfile -t djir-pricing .");
    expect(start).toBe(
      "docker run -d --name djir-pricing -p 8000:8000 djir-pricing",
    );
    expect(health).toContain("curl -fsS localhost:8000/health > health.json");
    expect(health).toContain(
      "sys.exit(json.load(open('health.json'))['models_loaded'] is not True)",
    );
    expect(uid).toBe("10001");
    expect(health).toContain(
      `test "$(docker exec djir-pricing id -u)" = ${uid}`,
    );
    expect(dockerfile).toMatch(/^USER djir$/m);
    expect(healthcheck).toContain(
      "docker inspect --format '{{.State.Health.Status}}' djir-pricing)\" = healthy && exit 0",
    );
    expect(logs).toBe("docker logs djir-pricing");
    expect(serving.steps[serving.steps.length - 1].if).toBe("failure()");
  });

  it("C6: the ml job's pip cache is keyed on both requirement files it installs", () => {
    const python = ml.steps.find((step) =>
      step.uses?.startsWith("actions/setup-python"),
    );

    expect(python?.with?.["cache-dependency-path"].trim().split("\n")).toEqual([
      "ml-platform/requirements-dev.txt",
      "ml-platform/serving/requirements.txt",
    ]);
    expect(read("ml-platform/requirements-dev.txt")).toContain(
      "-r serving/requirements.txt",
    );
  });
});
