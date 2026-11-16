import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, WIRED, write } from "./helpers.mjs";

const MOVE = "Move the shared logic to the module that owns the concept and import it from every caller.";
const BASELINE = ".standard/baselines/duplicates.json";

const TOTAL = [
  "export function total(items: number[]): number {",
  "  let sum = 0;",
  "  for (const item of items) sum += item * 2;",
  "  return sum;",
  "}",
  "",
].join("\n");

const DOUBLED = [
  "export const doubled = (values: readonly (number | undefined)[]) => {",
  "  let acc = 0;",
  "  for (const value of values)",
  "    acc += value! * 2;",
  "  return acc;",
  "};",
  "",
].join("\n");

const PICK = '(flag: boolean, left: string[], right: string[]) => (flag ? left.concat(right) : right.concat(left)).join("-")';

function repoWith(t, files) {
  const cwd = tempRepo(t);
  write(cwd, files);
  git(cwd, "add", "-A");
  return cwd;
}

function duplicates(cwd, ...flags) {
  return standard(cwd, ["check", "duplicates", ...flags]);
}


test("duplicates finds a function that repeats under other names, types and layout, and names every copy", (t) => {
  const { stdout, status } = duplicates(repoWith(t, { "src/a.ts": TOTAL, "src/b.tsx": `\n\n${DOUBLED}` }));
  assert.equal(
    stdout,
    [
      `duplicates: src/a.ts#total: src/a.ts:1 (total) has the same 18 normalized AST nodes as src/b.tsx:3 (doubled). ${MOVE}`,
      `duplicates: src/b.tsx#doubled: src/b.tsx:3 (doubled) has the same 18 normalized AST nodes as src/a.ts:1 (total). ${MOVE}`,
      "",
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("duplicates passes code that differs in a literal or a free name, and units under 8 nodes", (t) => {
  const { stdout, status } = duplicates(
    repoWith(t, {
      "src/a.ts": TOTAL,
      "src/literal.ts": TOTAL.replace("* 2", "* 3"),
      "src/free.ts": TOTAL.replace("sum += item", "sum += Math.abs(item)"),
      "src/other-free.ts": TOTAL.replace("sum += item", "sum += Math.ceil(item)"),
      "src/small-a.ts": "export const first = (list: string[]) => list.at(0);\n",
      "src/small-b.ts": "export const head = (items: string[]) => items.at(0);\n",
    }),
  );
  assert.equal(stdout, "duplicates: OK\n");
  assert.equal(status, 0);
});

test("duplicates scans only tracked .ts and .tsx sources outside tests, stories and declarations", (t) => {
  const cwd = repoWith(t, {
    "src/a.ts": TOTAL,
    "src/a.test.ts": TOTAL,
    "src/a.spec.tsx": TOTAL,
    "src/a.stories.tsx": TOTAL,
    "src/a.d.ts": "export declare function total(items: number[]): number;\n",
    "src/test/a.ts": TOTAL,
    "tests/a.ts": TOTAL,
    "src/__tests__/a.ts": TOTAL,
    "src/a.mjs": TOTAL.replaceAll(/: number(\[\])?/g, ""),
  });
  write(cwd, { "src/untracked.ts": TOTAL });
  const { stdout, status } = duplicates(cwd);
  assert.equal(stdout, "duplicates: OK\n");
  assert.equal(status, 0);
});

test("duplicates reports an outer copy once, and an inner copy only where no reported copy contains it", (t) => {
  const outer = (name) => `export function ${name}(flag: boolean, a: string[], b: string[]) {\n  const text = (flag ? a.concat(b) : b.concat(a)).join("-");\n  return text.length > 9 ? text.slice(0, 9) : text.padEnd(9);\n}\n`;
  const inner = "export const lone = (flag: boolean, a: string[], b: string[]) => (flag ? a.concat(b) : b.concat(a)).length;\n";
  const { stdout } = duplicates(repoWith(t, { "src/a.ts": outer("one"), "src/b.ts": outer("two"), "src/c.ts": inner }));
  assert.equal(
    stdout,
    [
      `duplicates: src/a.ts#one: src/a.ts:1 (one) has the same 39 normalized AST nodes as src/b.ts:1 (two). ${MOVE}`,
      `duplicates: src/b.ts#two: src/b.ts:1 (two) has the same 39 normalized AST nodes as src/a.ts:1 (one). ${MOVE}`,
      `duplicates: src/c.ts#lone>cond: src/c.ts:1 (lone>cond) has the same 12 normalized AST nodes as src/a.ts:2 (one>cond), src/b.ts:2 (two>cond). ${MOVE}`,
      "",
    ].join("\n"),
  );
});

test("duplicates keeps no baseline: --init refuses, a baseline file allows nothing, and pending holds it off", (t) => {
  const cwd = repoWith(t, { "src/a.ts": TOTAL, "src/b.ts": DOUBLED });
  const init = duplicates(cwd, "--init");
  assert.equal(init.stderr, "standard: duplicates allows no findings, so it has no baseline for --init. Fix what it finds.\n");
  assert.equal(init.status, 1);
  assert.equal(existsSync(join(cwd, BASELINE)), false);

  write(cwd, { [BASELINE]: { duplicates: ["src/a.ts#total", "src/b.ts#doubled"] } });
  const planted = duplicates(cwd);
  assert.match(planted.stdout, /^duplicates: src\/a\.ts#total: src\/a\.ts:1 \(total\) has the same 18 /);
  assert.equal(planted.status, 1);

  write(cwd, { ".standard/config.json": { pending: ["duplicates"] } });
  const pending = duplicates(cwd);
  assert.deepEqual([pending.stdout, pending.status], ["duplicates: pending in .standard/config.json, so it did not run\n", 0]);
});

test("duplicates numbers the copies that share a symbol path in one file", (t) => {
  const cwd = repoWith(t, { "src/a.ts": `export const pick = ${PICK};\nexport const pair = [${PICK}, ${PICK}];\n` });
  const keys = duplicates(cwd).stdout.split("\n").filter(Boolean).map((line) => line.split(": ")[1]);
  assert.deepEqual(keys.toSorted(), ["src/a.ts#fn", "src/a.ts#fn@2", "src/a.ts#pick"]);
});

test("duplicates fails the command on a file it cannot parse", (t) => {
  const { stderr, status } = duplicates(repoWith(t, { "src/a.ts": "export const = ;\n" }));
  assert.match(stderr, /^standard: duplicates could not parse src\/a\.ts\. /);
  assert.equal(status, 1);
});

test("duplicates does not apply to a repository with no TypeScript source", (t) => {
  const { stdout, status } = duplicates(repoWith(t, { "src/a.mjs": "export {};\n", "src/a.test.ts": TOTAL }));
  assert.equal(stdout, "duplicates: skipped, git tracks no TypeScript source to scan\n");
  assert.equal(status, 0);
});

test("wiring retires the duplicates script, its test and its baseline once duplicates is on", (t) => {
  const retired = ["scripts/check-duplicates.mjs", "scripts/check-duplicates.test.mjs", "scripts/baselines/duplicates.json"];
  const files = { ...WIRED, ...Object.fromEntries(retired.map((path) => [path, "old"])) };
  const wiring = (config) => standard(repoWith(t, { ...files, ".standard/config.json": config }), ["check", "wiring"]).stdout;
  assert.deepEqual(
    wiring({}).split("\n").filter((line) => line.includes("duplicates")),
    retired.map((path) => `wiring: ${path}: Delete ${path}, which the duplicates check replaces.`),
  );
  assert.doesNotMatch(wiring({ pending: ["duplicates"] }), /duplicates/);
});
