import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, WIRED, write } from "./helpers.mjs";

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
      "dead-code: 10 new findings.",
      "  Unlisted binary nolint in package.json. Add the package that provides it with pnpm add -D, or list it in knip.json ignoreBinaries if the machine provides it.",
      "  Unused dependency left-pad in package.json. Remove it with pnpm remove.",
      "  Unused devDependency right-pad in package.json. Remove it with pnpm remove.",
      "  Unlisted dependency unlisted-package in src/index.ts:2. Add it to that workspace's package.json with pnpm add.",
      "  Unresolved import ./missing in src/index.ts:3. Fix the specifier, or add the file or package it names.",
      "  Unused file src/orphan.ts. Delete it, or add its entry point to knip.json (workspaces.<ws>.entry) if a tool runs it.",
      "  Duplicate exports twice, again, default in src/used.ts:8. Keep one name and import it everywhere.",
      "  Unused enum member Color.Blue in src/used.ts:6. Delete it.",
      `  Unused export unused in src/used.ts:2. ${UNEXPORT}`,
      `  Unused exported type Unused in src/used.ts:3. ${UNEXPORT}`,
      "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.",
      "",
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("a dead-code key holds when the code moves to another line, and a new finding still fails", (t) => {
  const cwd = repoWith(t, FILES);
  assert.equal(deadCode(cwd, "--init").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/dead-code.json"), "utf8")), {
    "dead-code": [
      "package.json binaries nolint",
      "package.json dependencies left-pad",
      "package.json devDependencies right-pad",
      "src/index.ts unlisted unlisted-package",
      "src/index.ts unresolved ./missing",
      "src/orphan.ts files",
      "src/used.ts duplicates twice, again, default",
      "src/used.ts enumMembers Color.Blue",
      "src/used.ts exports unused",
      "src/used.ts types Unused",
    ],
  });

  write(cwd, { "src/used.ts": `\n\n${FILES["src/used.ts"]}` });
  const moved = deadCode(cwd);
  assert.equal(moved.stdout, "");
  assert.equal(moved.status, 0);

  write(cwd, { "src/used.ts": `${FILES["src/used.ts"]}export const late = 4;\n` });
  const { stdout, status } = deadCode(cwd);
  assert.match(stdout, /^dead-code: 1 new findings\.\n {2}Unused export late in src\/used\.ts:11\. /);
  assert.equal(status, 1);
});

test("dead-code runs knip with the repository's own knip.json", (t) => {
  const cwd = repoWith(t, {
    "package.json": { name: "fixture", dependencies: { "left-pad": "1.0.0" } },
    "tools/run.ts": "export {};\n",
  });
  assert.match(deadCode(cwd).stdout, /^dead-code: 2 new findings\.\n {2}Unused dependency left-pad .*\n {2}Unused file tools\/run\.ts\. /);

  write(cwd, { "knip.json": { entry: ["tools/run.ts"], ignoreDependencies: ["left-pad"] } });
  const { stdout, status } = deadCode(cwd);
  assert.equal(stdout, "");
  assert.equal(status, 0);
});

test("dead-code fails the command when knip cannot read the repository", (t) => {
  const cwd = repoWith(t, { "package.json": { name: "fixture" }, "knip.json": { entry: 5 } });
  const { stdout, stderr, status } = deadCode(cwd);
  assert.equal(stdout, "");
  assert.equal(stderr, "standard: dead-code could not run knip. ERROR: Invalid input (location: entry, expected: array)\n");
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
