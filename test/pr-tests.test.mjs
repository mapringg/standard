import assert from "node:assert/strict";
import { test } from "node:test";

import { checkEvent, git, pullRequestEvent, pullRequestRepo } from "./helpers.mjs";

const OK = "pr-tests: OK (#123)\n";

const PACKAGES = {
  "package.json": { name: "root" },
  "apps/api/package.json": { name: "api" },
  "apps/web/package.json": { name: "web" },
};

const PARSE = [
  'import { split } from "./split";',
  'import type { Options } from "./options";',
  "",
  "/** Reads a line. */",
  "export function parse(line: string, options: Options): string[] {",
  "  return split(line).map((part) => part.trim());",
  "}",
  "",
  "export function count(line: string): number {",
  "  return line.length;",
  "}",
  "",
].join("\n");

const TEST = ['import { test } from "node:test";', "", 'test("parse splits a line", () => {', '  assert.deepEqual(parse("a b"), ["a", "b"]);', "});", ""].join("\n");

function prTests(t, head, base = {}) {
  const repo = pullRequestRepo(t, { base: { ...PACKAGES, ...base }, head });
  const { stdout, status } = checkEvent(t, repo.cwd, pullRequestEvent({ base: repo.base, head: repo.head }), ["pr-tests"]);
  return { stdout, status, repo };
}

function passes(t, head, base) {
  const { stdout, status } = prTests(t, head, base);
  assert.deepEqual([stdout, status], [OK, 0]);
}

function fails(t, head, base, ...lines) {
  const { stdout, status } = prTests(t, head, base);
  assert.equal(stdout, lines.map((line) => `::error title=pr-tests::${line}\n`).join(""));
  assert.equal(status, 1);
}

const edited = (from, to) => PARSE.replace(from, to);
const missing = (path, folder = "apps/api") =>
  `${folder}: ${path} adds logic, but no test in ${folder} adds any. Add or change a test there, such as ${path.replace(/\.ts$/, ".test.ts")}, that covers it.`;

test("pr-tests passes a logic change that comes with a test change in the same package", (t) => {
  passes(
    t,
    { "apps/api/src/parse.ts": edited("part.trim()", "part.trimEnd()"), "apps/api/test/parse.test.ts": TEST },
    { "apps/api/src/parse.ts": PARSE },
  );
});

test("pr-tests fails a logic change whose only test change is in another package, and names the package", (t) => {
  fails(
    t,
    {
      "apps/api/src/parse.ts": edited("part.trim()", "part.trimEnd()"),
      "apps/api/src/other.ts": "export const twice = (n: number) => n * 2;\n",
      "apps/web/src/page.test.tsx": TEST,
    },
    { "apps/api/src/parse.ts": PARSE },
    "apps/api: apps/api/src/other.ts and 1 more add logic, but no test in apps/api adds any. Add or change a test there, such as apps/api/src/other.test.ts, that covers it.",
  );
});

test("pr-tests asks for a test when a new source file adds a function", (t) => {
  fails(
    t,
    { "src/format.tsx": "export function format(value: number) {\n  return value.toFixed(2);\n}\n" },
    {},
    ".: src/format.tsx adds logic, but no test in the root package adds any. Add or change a test there, such as src/format.test.tsx, that covers it.",
  );
});

test("pr-tests counts a new enum as logic", (t) => {
  fails(
    t,
    { "src/level.ts": "export enum Level {\n  Low,\n  High,\n}\n" },
    {},
    ".: src/level.ts adds logic, but no test in the root package adds any. Add or change a test there, such as src/level.test.ts, that covers it.",
  );
});

test("pr-tests passes changes that add no logic, with no test", (t) => {
  const cases = {
    "a type-only edit": edited("options: Options): string[]", "options: Readonly<Options>): readonly string[]"),
    "a deleted function": edited("export function count(line: string): number {\n  return line.length;\n}\n", ""),
    "a dropped export keyword": edited("export function count", "function count"),
    "an import-only change": edited('import { split } from "./split";', 'import { split, join } from "./split.js";'),
    "a comment and format change": edited("/** Reads a line. */\n", "// Reads one line.\n").replace("  return split(line).map((part) => part.trim());", "  return split(line)\n    .map((part) => (part.trim()));"),
    "a cast and a new type": `${edited("line.length", "(line as string).length")}\nexport type Parsed = string[];\ninterface Hidden { a: number }\ndeclare const injected: number;\n`,
  };
  for (const [label, text] of Object.entries(cases)) {
    const { stdout, status } = prTests(t, { "apps/api/src/parse.ts": text }, { "apps/api/src/parse.ts": PARSE });
    assert.deepEqual([stdout, status], [OK, 0], label);
  }
});

test("pr-tests passes a translation table edit, declarations, generated code and stories", (t) => {
  const table = 'export const messages = { hello: "Hello", bye: `Bye ${"now"}`, list: ["a", -1, , +2], ["x-y"]: null, nested: { on: true } };\n';
  passes(
    t,
    {
      "apps/web/src/i18n/en.ts": table.replace('"Hello"', '"Hi"').replace("list:", "extra: /a+/g, list:"),
      "apps/web/src/env.d.ts": "declare function hook(): void;\n",
      "apps/web/src/generated/client.ts": "export function call() { return fetch('/'); }\n",
      "apps/web/src/api.gen.ts": "export function call() { return 1; }\n",
      "apps/web/src/button.stories.tsx": "export function Primary() { return null; }\n",
      "apps/web/src/__tests__/helper.ts": "export function helper() { return 1; }\n",
      "apps/web/lib/outside-src.ts": "export function outside() { return 1; }\n",
    },
    { "apps/web/src/i18n/en.ts": table },
  );
});

test("pr-tests does not count a test file change that is whitespace only", (t) => {
  fails(
    t,
    { "apps/api/src/parse.ts": edited("part.trim()", "part.trimEnd()"), "apps/api/test/parse.test.ts": TEST.replace("() => {", "()=>{\n") },
    { "apps/api/src/parse.ts": PARSE, "apps/api/test/parse.test.ts": TEST },
    "apps/api: apps/api/src/parse.ts adds logic, but no test in apps/api adds any. Add or change a test there, such as apps/api/src/parse.test.ts, that covers it.",
  );
});

test("pr-tests passes a renamed source with no content change", (t) => {
  const { stdout, status, repo } = prTests(t, { "apps/api/src/parse.ts": null, "apps/api/src/parsing/parse.ts": PARSE }, { "apps/api/src/parse.ts": PARSE });
  assert.match(git(repo.cwd, "diff", "--name-status", "-M", repo.base, repo.head), /^R100/);
  assert.deepEqual([stdout, status], [OK, 0]);
});

test("pr-tests counts a source it cannot parse as logic, and a test it cannot parse as no test", (t) => {
  fails(
    t,
    { "apps/api/src/broken.ts": "export function (", "apps/api/src/broken.test.ts": "test(" },
    {},
    "apps/api: apps/api/src/broken.ts adds logic, but no test in apps/api adds any. Add or change a test there, such as apps/api/src/broken.test.ts, that covers it.",
  );
});

test("pr-tests reads the package from the head commit and diffs from the merge base", (t) => {
  const { cwd, base } = pullRequestRepo(t, { base: PACKAGES, head: { "apps/api/src/new.ts": "export const run = () => 1;\n", "apps/api/src/new.test.ts": TEST } });
  git(cwd, "switch", "-q", "develop");
  git(cwd, "commit", "-q", "--allow-empty", "--no-verify", "-m", "Move develop ahead of the branch");
  const ahead = git(cwd, "rev-parse", "HEAD");
  const { stdout, status } = checkEvent(t, cwd, pullRequestEvent({ base: ahead, head: git(cwd, "rev-parse", "feature") }), ["pr-tests"]);
  assert.notEqual(ahead, base);
  assert.deepEqual([stdout, status], [OK, 0]);
});

test("pr-tests credits no test that is empty, skipped, pending or focused", (t) => {
  const source = { "apps/api/src/a.ts": "export function compute(n: number) { return n * 2; }\n" };
  for (const body of [
    'it("works", () => {});',
    'it.skip("works", () => { throw Error("never"); });',
    'describe.skip("suite", () => { it("works", () => { throw Error("never"); }); });',
    'test.todo("works");',
    'it.only("works", () => { expect(compute(1)).toBe(2); });',
    'describe("suite", () => { it.concurrent.only("works", () => { expect(compute(1)).toBe(2); }); });',
    'xit("works", () => { expect(compute(1)).toBe(2); });',
    'it.skipIf(ci)("works", () => { expect(compute(1)).toBe(2); });',
    'test("works", { skip: true }, () => { assert.equal(compute(1), 2); });',
    'const n = 1;',
  ]) {
    const { stdout, status } = prTests(t, { ...source, "apps/api/test/a.test.ts": body });
    assert.deepEqual([stdout, status], [`::error title=pr-tests::${missing("apps/api/src/a.ts")}\n`, 1], body);
  }
  for (const body of [
    'it.each([1, 2])("works for %d", (n) => { expect(compute(n)).toBe(n * 2); });',
    'describe.concurrent("suite", () => { beforeEach(reset); it("works", () => expect(compute(1)).toBe(2)); });',
    'test("works", { timeout: 10 }, async function () { assert.equal(compute(1), 2); });',
  ]) {
    const { stdout, status } = prTests(t, { ...source, "apps/api/test/a.test.ts": body });
    assert.deepEqual([stdout, status], [OK, 0], body);
  }
});

test("pr-tests credits no test that moved or was renamed", (t) => {
  const source = { "apps/api/src/a.ts": "export const compute = (n: number) => n * 2;\n" };
  const kept = 'it("works", () => { expect(compute(1)).toBe(2); });\n';
  const other = 'it("other", () => { expect(compute(2)).toBe(4); });\n';
  fails(t, { ...source, "apps/api/test/old.test.ts": null, "apps/api/test/new.test.ts": kept }, { "apps/api/test/old.test.ts": kept }, missing("apps/api/src/a.ts"));
  fails(t, { ...source, "apps/api/test/b.test.ts": `${other}${kept}`, "apps/api/test/c.test.ts": other }, { "apps/api/test/b.test.ts": other, "apps/api/test/c.test.ts": `${other}${kept}` }, missing("apps/api/src/a.ts"));
});

test("pr-tests counts code that runs inside a namespace or a decorator", (t) => {
  fails(t, { "apps/api/src/a.ts": 'export namespace Ops { export function go() { return fetch("/"); } }\n' }, {}, missing("apps/api/src/a.ts"));
  fails(t, { "apps/api/src/a.ts": '@register("new") export class A {}\n' }, { "apps/api/src/a.ts": '@register("old") export class A {}\n' }, missing("apps/api/src/a.ts"));
  passes(t, { "apps/api/src/a.ts": "export namespace Types { export type Id = string; export namespace Inner { export interface Row {} } }\n" });
});

test("pr-tests counts data that runs code as logic", (t) => {
  for (const text of [
    "export const cleared = delete globalThis.cache;\n",
    "export const state = { [delete globalThis.cache]: 1 };\n",
    "export const value = globalThis.trigger.value;\n",
    "export const copy = { ...defaults };\n",
    "export default [size];\n",
  ]) {
    const { stdout, status } = prTests(t, { "apps/api/src/a.ts": text });
    assert.deepEqual([stdout, status], [`::error title=pr-tests::${missing("apps/api/src/a.ts")}\n`, 1], text);
  }
  passes(t, { "apps/api/src/a.ts": 'export const LEVELS = ["low", "high"] as const;\nexport default { retries: 3 } satisfies Options;\nlet unset;\n' });
});

test("pr-tests counts a statement that the head runs more times than the base", (t) => {
  fails(t, { "apps/api/src/a.ts": "charge(1);\ncharge(1);\n" }, { "apps/api/src/a.ts": "charge(1);\n" }, missing("apps/api/src/a.ts"));
});

test("pr-tests passes modifiers that TypeScript erases", (t) => {
  const cases = [
    ["export function f(n: number) { return n; }", "export function f(n?: number) { return n; }"],
    ["export class A { f() { return 1; } }", "export abstract class A { f() { return 1; } abstract g(): void; }"],
    ["export class A { x = 1; f() { return 1; } }", "export class A { readonly x = 1; private f() { return 1; } }"],
    ["export class B extends A { f() { return 1; } }", "export class B extends A { override f() { return 1; } declare y: number; }"],
    ["export function g(a: any) { return a; }", "export function g(a: string): string;\nexport function g(a: any) { return a; }"],
  ];
  for (const [before, after] of cases) {
    const { stdout, status } = prTests(t, { "apps/api/src/a.ts": `${after}\n` }, { "apps/api/src/a.ts": `${before}\n` });
    assert.deepEqual([stdout, status], [OK, 0], after);
  }
  fails(t, { "apps/api/src/a.ts": "export const read = (a) => a?.b;\n" }, { "apps/api/src/a.ts": "export const read = (a) => a.b;\n" }, missing("apps/api/src/a.ts"));
});

test("pr-tests passes a function moved between files of one package, and fails one moved to another package", (t) => {
  const run = "export function run() {\n  return start();\n}\n";
  passes(t, { "apps/api/src/a.ts": "export const unused = 1;\n", "apps/api/src/b.ts": run }, { "apps/api/src/a.ts": run, "apps/api/src/b.ts": "" });
  fails(t, { "apps/api/src/a.ts": null, "apps/web/src/a.ts": `${run}export const extra = 1;\n` }, { "apps/api/src/a.ts": run }, missing("apps/web/src/a.ts", "apps/web"));
});
