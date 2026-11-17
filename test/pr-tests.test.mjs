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

const TEST = ['import { test } from "node:test";', "", 'test("parse splits a line", () => {});', ""].join("\n");

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
  const table = 'export const messages = { hello: "Hello", bye: `Bye ${"now"}`, list: ["a", -1], ...base.extra };\n';
  passes(
    t,
    {
      "apps/web/src/i18n/en.ts": table.replace('"Hello"', '"Hi"').replace("list:", 'extra: other.value, list:'),
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
    { "apps/api/src/parse.ts": edited("part.trim()", "part.trimEnd()"), "apps/api/test/parse.test.ts": TEST.replace("{});", "{ });\n\n") },
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
