import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { git, standard, tempDir, tempRepo, WIRED, write } from "./helpers.mjs";

const EMPTY_ROW = Object.fromEntries(
  ["binaries", "catalog", "catalogReferences", "dependencies", "devDependencies", "duplicates", "enumMembers", "exports", "files", "namespaceMembers", "optionalPeerDependencies", "types", "unlisted", "unresolved"].map((kind) => [kind, []]),
);

const UNEXPORT = "Delete it, or drop the 'export' keyword if only this file uses it.";

const FILES = {
  "package.json": {
    name: "fixture",
    main: "src/index.ts",
    scripts: { lint: "nolint src" },
    dependencies: { "left-pad": "1.0.0" },
    devDependencies: { "right-pad": "1.0.0" },
  },
  ".github/CODEOWNERS": "* @owner\n",
  "src/index.ts": [
    'import alias, { again, Color, twice, used } from "./used";',
    'import "unlisted-package";',
    'import "./missing";',
    "",
    "console.log(alias, again, Color.Red, twice, used);",
    "",
  ].join("\n"),
  "src/used.ts": [
    "export const used = 1;",
    "export const unused = 2;",
    "export type Unused = string;",
    "export enum Color {",
    "  Red,",
    "  Blue,",
    "}",
    "export const twice = 3;",
    "export const again = twice;",
    "export default twice;",
    "",
  ].join("\n"),
  "src/orphan.ts": "export const orphan = 1;\n",
};

function repoWith(t, files) {
  const cwd = tempRepo(t);
  write(cwd, files);
  git(cwd, "add", "-A");
  return cwd;
}

function deadCode(cwd, ...flags) {
  return standard(cwd, ["check", "dead-code", ...flags]);
}

test("dead-code turns each knip issue into a finding whose fix names the change", (t) => {
  const { stdout, status } = deadCode(repoWith(t, FILES));
  assert.equal(
    stdout,
    [
      "dead-code: src/orphan.ts files: Unused file src/orphan.ts. Delete it, or add its entry point to knip.json (workspaces.<ws>.entry) if a tool runs it.",
      "dead-code: package.json binaries nolint: Unlisted binary nolint in package.json. Add the package that provides it with pnpm add -D, or list it in knip.json ignoreBinaries if the machine provides it.",
      "dead-code: package.json dependencies left-pad: Unused dependency left-pad in package.json. Remove it with pnpm remove.",
      "dead-code: package.json devDependencies right-pad: Unused devDependency right-pad in package.json. Remove it with pnpm remove.",
      "dead-code: src/index.ts unlisted unlisted-package: Unlisted dependency unlisted-package in src/index.ts:2. Add it to that workspace's package.json with pnpm add.",
      "dead-code: src/index.ts unresolved ./missing: Unresolved import ./missing in src/index.ts:3. Fix the specifier, or add the file or package it names.",
      "dead-code: src/used.ts duplicates twice, again, default: Duplicate exports twice, again, default in src/used.ts:8. Keep one name and import it everywhere.",
      "dead-code: src/used.ts enumMembers Color.Blue: Unused enum member Color.Blue in src/used.ts:6. Delete it.",
      `dead-code: src/used.ts exports unused: Unused export unused in src/used.ts:2. ${UNEXPORT}`,
      `dead-code: src/used.ts types Unused: Unused exported type Unused in src/used.ts:3. ${UNEXPORT}`,
      "",
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("dead-code keeps no baseline: --init refuses, a baseline file allows nothing, and pending holds it off", (t) => {
  const cwd = repoWith(t, { "package.json": { name: "fixture", main: "src/index.ts" }, "src/index.ts": "export {};\n", "src/orphan.ts": "export {};\n" });
  const init = deadCode(cwd, "--init");
  assert.equal(init.stderr, "standard: dead-code allows no findings, so it has no baseline for --init. Fix what it finds.\n");
  assert.equal(init.status, 1);
  assert.equal(existsSync(join(cwd, ".standard/baselines/dead-code.json")), false);

  write(cwd, { ".standard/baselines/dead-code.json": { "dead-code": ["src/orphan.ts files"] } });
  const planted = deadCode(cwd);
  assert.match(planted.stdout, /^dead-code: src\/orphan\.ts files: Unused file src\/orphan\.ts\. /);
  assert.equal(planted.status, 1);

  write(cwd, { ".standard/config.json": { pending: ["dead-code"] } });
  assert.deepEqual([deadCode(cwd).stdout, deadCode(cwd).status], ["dead-code: pending in .standard/config.json, so it did not run\n", 0]);
});

test("dead-code fails on a knip report it does not understand and names the knip version", async (t) => {
  const dir = tempDir(t, "knip-report");
  mkdirSync(join(dir, "src/checks"), { recursive: true });
  mkdirSync(join(dir, "node_modules/knip/bin"), { recursive: true });
  copyFileSync(join(import.meta.dirname, "../src/checks/dead-code.mjs"), join(dir, "src/checks/dead-code.mjs"));
  write(dir, {
    "node_modules/knip/package.json": { name: "knip", version: "9.9.9", type: "module", exports: "./bin/knip.js" },
  });
  const { default: check } = await import(pathToFileURL(join(dir, "src/checks/dead-code.mjs")).href);
  const cwd = repoWith(t, { "package.json": { name: "fixture" } });
  const cases = [
    [{ issues: [{ file: "src/orphan.ts" }] }, /^Error: dead-code read a knip 9\.9\.9 report it does not understand: row 0 \(src\/orphan\.ts\) lacks binaries, .*Reinstall @mapringg\/standard/],
    [{ issues: [], files: ["src/orphan.ts"] }, /: it has the unknown top-level key files\./],
    [{ issues: [{ file: "a.ts", ...EMPTY_ROW, mystery: [] }] }, /: row 0 \(a\.ts\) has the unknown issue type mystery\./],
    [{ issues: [{ file: "a.ts", ...EMPTY_ROW, exports: [{ line: 1 }] }] }, /: row 0 \(a\.ts\) has exports entries without a name\./],
    ["nonsense", /: its output is not JSON/],
  ];
  for (const [report, message] of cases) {
    const text = typeof report === "string" ? report : JSON.stringify(report);
    writeFileSync(join(dir, "node_modules/knip/bin/knip.js"), `console.log(${JSON.stringify(text)});\n`);
    await assert.rejects(() => check.run({ root: cwd }), message);
  }
  writeFileSync(join(dir, "node_modules/knip/bin/knip.js"), `console.log(${JSON.stringify(JSON.stringify({ issues: [{ file: "a.ts", ...EMPTY_ROW, owners: ["@o"], files: [{ name: "a.ts" }] }] }))});\n`);
  assert.deepEqual(await check.run({ root: cwd }), [{ key: "a.ts files", fix: "Unused file a.ts. Delete it, or add its entry point to knip.json (workspaces.<ws>.entry) if a tool runs it." }]);
  write(dir, { "node_modules/knip/package.json": { name: "knip", type: "module", exports: "./bin/knip.js" } });
  const { default: unversioned } = await import(`${pathToFileURL(join(dir, "src/checks/dead-code.mjs")).href}?unversioned`);
  writeFileSync(join(dir, "node_modules/knip/bin/knip.js"), "console.log('{}');\n");
  await assert.rejects(() => unversioned.run({ root: cwd }), /dead-code read a knip \(version unknown\) report it does not understand: it has no issues list\./);
});

test("dead-code runs knip with the repository's own knip.json", (t) => {
  const cwd = repoWith(t, {
    "package.json": { name: "fixture", dependencies: { "left-pad": "1.0.0" } },
    "tools/run.ts": "export {};\n",
  });
  assert.match(deadCode(cwd).stdout, /^dead-code: tools\/run\.ts files: Unused file tools\/run\.ts\. .*\ndead-code: package\.json dependencies left-pad: Unused dependency left-pad /);

  write(cwd, { "knip.json": { entry: ["tools/run.ts"], ignoreDependencies: ["left-pad"] } });
  const { stdout, status } = deadCode(cwd);
  assert.equal(stdout, "dead-code: OK\n");
  assert.equal(status, 0);
});

test("dead-code fails the command when knip cannot read the repository", (t) => {
  const cwd = repoWith(t, { "package.json": { name: "fixture" }, "knip.json": { entry: 5 } });
  const { stdout, stderr, status } = deadCode(cwd);
  assert.equal(stdout, "");
  assert.equal(stderr, "standard: dead-code could not run knip 6.45.1. ERROR: Invalid input (location: entry, expected: array)\n");
  assert.equal(status, 1);
});

test("dead-code does not apply without a tracked package.json", (t) => {
  const { stdout, status } = deadCode(repoWith(t, { "src/orphan.ts": "export const orphan = 1;\n" }));
  assert.equal(stdout, "dead-code: skipped, git tracks no package.json for knip to read\n");
  assert.equal(status, 0);
});

test("wiring retires the dead-code script, its test and its baseline once dead-code is on", (t) => {
  const retired = ["scripts/check-dead-code.mjs", "scripts/check-dead-code.test.mjs", "scripts/baselines/dead-code.json"];
  const files = { ...WIRED, ...Object.fromEntries(retired.map((path) => [path, "old"])) };
  const wiring = (config) => standard(repoWith(t, { ...files, ".standard/config.json": config }), ["check", "wiring"]).stdout;
  assert.deepEqual(
    wiring({}).split("\n").filter((line) => line.includes("dead-code")),
    retired.map((path) => `wiring: ${path}: Delete ${path}, which the dead-code check replaces.`),
  );
  assert.doesNotMatch(wiring({ pending: ["dead-code"] }), /dead-code/);
});
