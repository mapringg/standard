import assert from "node:assert/strict";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const COMMENT = "Move the why into a name, a test name or a type, or delete the comment. For a decision an agent would otherwise undo, write it under a heading in docs/*.md or apps/*/docs/*.md and point at it alone on a line with // See: <path>.md#<heading>.";

function check(t, files) {
  const cwd = tempRepo(t, {});
  write(cwd, files);
  git(cwd, "add", "-A");
  return standard(cwd, ["check", "no-comments"]);
}

function passes(t, files) {
  const { stdout, stderr, status } = check(t, files);
  assert.deepEqual([stdout, stderr, status], ["no-comments: OK\n", "", 0]);
}

function fails(t, files, ...lines) {
  const { stdout, stderr, status } = check(t, files);
  assert.equal(stderr, "");
  assert.equal(stdout, lines.map((line) => `no-comments: ${line}\n`).join(""));
  assert.equal(status, 1);
}

test("no-comments fails every prose comment, JSDoc and JSX included, and passes a hashbang and a directive prologue", (t) => {
  passes(t, { "bin/cli.mjs": "#!/usr/bin/env node\nconsole.log(1);\n", "src/page.tsx": '"use client";\n\nexport const Page = () => <div />;\n' });
  fails(
    t,
    {
      "src/a.ts": "// explains\nexport const a = 1; // TODO: later\n/* block */\n",
      "src/b.ts": "/** Explains the export. */\nexport const b = 1;\n",
      "src/c.tsx": "export const C = () => <div>{/* hidden */}</div>;\n",
    },
    `src/a.ts comment: src/a.ts has comments on lines 1, 2, 3. ${COMMENT}`,
    `src/b.ts comment: src/b.ts has a comment on line 1. ${COMMENT}`,
    `src/c.tsx comment: src/c.tsx has a comment on line 1. ${COMMENT}`,
  );
});

test("no-comments passes a lint directive with a reason and fails one without", (t) => {
  passes(t, {
    "src/a.ts": "// oxlint-disable-next-line no-console -- the CLI prints to stdout\nconsole.log(1);\n/* eslint-disable no-console -- a script */\n/* eslint-enable no-console */\n",
    "src/b.tsx": "export const B = () => <div>{/* oxlint-disable-next-line no-img-element -- intrinsic sizing */}<img /></div>;\n",
  });
  fails(
    t,
    { "src/a.ts": "// oxlint-disable-next-line no-console\nconsole.log(1);\n// eslint-disable-line no-console --\n" },
    "src/a.ts lint-directive: src/a.ts has comments on lines 1, 3. Add ` -- <reason>` after the rule names.",
  );
});

test("no-comments passes @ts-expect-error with a reason and fails a bare one, @ts-ignore and @ts-nocheck", (t) => {
  passes(t, { "src/a.ts": "// @ts-expect-error passing an out-of-union value pins the fallback\nf('x');\n" });
  fails(
    t,
    { "src/a.ts": "// @ts-expect-error\nf('x');\n// @ts-ignore\nf('y');\n", "src/b.ts": "// @ts-nocheck\nexport {};\n" },
    "src/a.ts ts-directive: src/a.ts has a comment on line 1. Say why the error is expected after @ts-expect-error.",
    "src/a.ts ts-directive: src/a.ts has a comment on line 3. Fix the type error, or write @ts-expect-error with the reason on the line above it.",
    "src/b.ts ts-directive: src/b.ts has a comment on line 1. Fix the type error, or write @ts-expect-error with the reason on the line above it.",
  );
});

test("no-comments passes a finished SAFETY comment above the type assertion it justifies", (t) => {
  passes(t, {
    "src/line.ts": "// SAFETY: the validator ran first.\nexport const a = value as Input;\n",
    "src/lines.ts": "// SAFETY: the validator ran first,\n// so the shape holds.\nexport const a = value as Input;\n",
    "src/return.ts": "export function f() {\n  // SAFETY: why else would the validator run first?\n  return value as Input;\n}\n",
    "src/block.ts": "/* SAFETY: the guard narrows to `Input.` */\nexport const a = <Input>value;\n",
    "src/directive.ts": "export const f = () =>\n  // SAFETY: the cast under test.\n  // @ts-expect-error a named row is not a cell array\n  (rows as Row[]).map(String);\n",
  });
});

test("no-comments fails an unfinished SAFETY comment, and one with no type assertion to justify", (t) => {
  fails(
    t,
    {
      "src/unfinished.ts": "// SAFETY: the validator ran first,\n// so the shape holds\nexport const a = value as Input;\n",
      "src/const.ts": "// SAFETY: a literal.\nexport const a = [1] as const;\n",
      "src/far.ts": "// SAFETY: the validator ran first.\nconst b = 1;\nexport const a = value as Input;\n",
    },
    "src/const.ts safety: src/const.ts has a comment on line 1. Delete the SAFETY comment, or put it directly above the type assertion it justifies.",
    "src/far.ts safety: src/far.ts has a comment on line 1. Delete the SAFETY comment, or put it directly above the type assertion it justifies.",
    "src/unfinished.ts safety: src/unfinished.ts has a comment on line 1. Finish the SAFETY sentence that states the invariant, and end it with ., ? or !.",
  );
});

test("no-comments passes a See: pointer to a tracked doc and heading, and fails one that does not resolve", (t) => {
  const docs = { "docs/time.md": "# Time\n\n## Why UTC on the wire\n", "apps/web/docs/summary.md": "# Summary\n", "apps/web/notes.md": "# Notes\n" };
  passes(t, { ...docs, "src/a.ts": "// See: docs/time.md#why-utc-on-the-wire\nexport const a = 1;\n// See: apps/web/docs/summary.md\n" });
  fails(
    t,
    { ...docs, "src/a.ts": "// See: docs/time.md#why-local\n// See: apps/web/notes.md\n// See: docs/missing.md\nexport const a = 1;\n" },
    "src/a.ts doc-pointer: src/a.ts has a comment on line 1. Point at a heading docs/time.md has, as GitHub slugs it, or drop the anchor; it has no #why-local.",
    "src/a.ts doc-pointer: src/a.ts has a comment on line 2. Point at a tracked doc that matches docs/*.md or apps/*/docs/*.md, with a path from the repository root; apps/web/notes.md is not one.",
    "src/a.ts doc-pointer: src/a.ts has a comment on line 3. Point at a tracked doc that matches docs/*.md or apps/*/docs/*.md, with a path from the repository root; docs/missing.md is not one.",
  );
});

test("no-comments passes a license header above the code, and fails a license comment below it", (t) => {
  passes(t, {
    "src/spdx.ts": "// SPDX-License-Identifier: MIT\n// Copyright 2026 Someone\nexport const a = 1;\n",
    "src/vendor.js": "/**\n * @license\n * Copyright Someone. MIT.\n */\nexport const a = 1;\n",
  });
  fails(
    t,
    { "src/a.ts": "export const a = 1;\n// SPDX-License-Identifier: MIT\n", "src/b.ts": "// SPDX-License-Identifier: MIT\nexport const b = 1;\n// explains\n" },
    `src/a.ts comment: src/a.ts has a comment on line 2. ${COMMENT}`,
    `src/b.ts comment: src/b.ts has a comment on line 3. ${COMMENT}`,
  );
});

test("no-comments skips a generated file, named by its header or as next-env.d.ts, and still reads a .d.ts", (t) => {
  passes(t, {
    "apps/web/next-env.d.ts": '/// <reference types="next" />\n// NOTE: This file should not be edited\n',
    "apps/api/worker-configuration.d.ts": "/* eslint-disable */\n// Generated by Wrangler by running `wrangler types`\ninterface Env {}\n",
    "src/schema.ts": "// @generated\n// explains\nexport const a = 1;\n",
  });
  fails(
    t,
    { "src/env.d.ts": '/// <reference types="vite/client" />\n', "src/a.ts": "export const a = 1;\n// @generated\n" },
    `src/a.ts comment: src/a.ts has a comment on line 2. ${COMMENT}`,
    `src/env.d.ts comment: src/env.d.ts has a comment on line 1. ${COMMENT}`,
  );
});

test("no-comments fails a source it cannot parse", (t) => {
  const { stdout, status } = check(t, { "src/a.ts": "export const = ;\n" });
  assert.match(stdout, /^no-comments: src\/a\.ts parse: src\/a\.ts does not parse, so no-comments cannot read it: .+\. Fix the syntax\.\n$/);
  assert.equal(status, 1);
});

test("wiring fails a repo plugin's no-comments rule and its test, which no-comments replaces", (t) => {
  const cwd = tempRepo(t, {});
  write(cwd, {
    "packages/oxlint-plugin-app/rules/no-comments.ts": "export {};\n",
    "packages/oxlint-plugin-app/rules/no-comments.test.ts": "export {};\n",
    "packages/oxlint-plugin-app/shared/safety-comment.ts": "export {};\n",
  });
  git(cwd, "add", "-A");
  const { stdout } = standard(cwd, ["check", "wiring"]);
  assert.match(stdout, /^wiring: packages\/oxlint-plugin-app\/rules\/no-comments\.ts: Delete packages\/oxlint-plugin-app\/rules\/no-comments\.ts, which the no-comments check replaces\.$/m);
  assert.match(stdout, /^wiring: packages\/oxlint-plugin-app\/rules\/no-comments\.test\.ts: Delete .+, which the no-comments check replaces\.$/m);
  assert.doesNotMatch(stdout, /safety-comment/);
});
