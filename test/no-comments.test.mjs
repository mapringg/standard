import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const COMMENT = "Move the why into a name, a test name or a type, or delete the comment. For a decision an agent would otherwise undo, write it under a heading in docs/*.md or apps/*/docs/*.md and point at it alone on a line with // See: <path>.md#<heading>.";
const HTML = "An HTML comment ships to every visitor. Move the why into a name or a doc, and delete the comment.";
const LICENSE = "Keep only a leading `SPDX-License-Identifier: <expression>` line, whose expression names SPDX license ids such as `MIT` or `Apache-2.0 OR MIT`. If this is third-party code that must keep its copyright or notice, mark its path `linguist-vendored` in `.gitattributes`.";

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
    { "src/a.ts": "// @ts-expect-error\nf('x');\n// @ts-ignore\nf('y');\n", "src/b.ts": "// @ts-nocheck\nexport {};\n", "src/c.ts": "// @ts-expect-error: -\nf('z');\n" },
    "src/a.ts ts-directive: src/a.ts has a comment on line 1. Say why the error is expected after @ts-expect-error.",
    "src/a.ts ts-directive: src/a.ts has a comment on line 3. Fix the type error, or write @ts-expect-error with the reason on the line above it.",
    "src/b.ts ts-directive: src/b.ts has a comment on line 1. Fix the type error, or write @ts-expect-error with the reason on the line above it.",
    "src/c.ts ts-directive: src/c.ts has a comment on line 1. Say why the error is expected after @ts-expect-error.",
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

const MIT = [
  "SPDX-License-Identifier: MIT",
  "Copyright (c) 2026 Someone",
  "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated",
  'documentation files (the "Software"), to deal in the Software without restriction, including without limitation the',
  "rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit",
  "persons to whom the Software is furnished to do so, subject to the following conditions:",
  "",
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the",
  "Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE',
  "WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR",
  "COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR",
  "OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
];

const APACHE = [
  "Copyright 2026 Someone",
  "",
  'Licensed under the Apache License, Version 2.0 (the "License");',
  "you may not use this file except in compliance with the License.",
  "You may obtain a copy of the License at",
  "",
  "    http://www.apache.org/licenses/LICENSE-2.0",
  "",
  "Unless required by applicable law or agreed to in writing, software",
  'distributed under the License is distributed on an "AS IS" BASIS,',
  "WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.",
  "See the License for the specific language governing permissions and",
  "limitations under the License.",
];

const block = (lines) => `/*\n${lines.map((line) => ` *${line && ` ${line}`}`).join("\n")}\n */\n`;
const slashes = (lines) => lines.map((line) => `//${line && ` ${line}`}\n`).join("");

test("no-comments passes a leading license tag that names a license expression alone, and skips vendored files", (t) => {
  passes(t, {
    ".gitattributes": "vendor/** linguist-vendored\nsrc/third-party.js linguist-vendored=true\n",
    "src/spdx.ts": "// SPDX-License-Identifier: MIT\nexport const a = 1;\n",
    "src/spdx-block.ts": "/* SPDX-License-Identifier: Apache-2.0 OR MIT */\nexport const a = 1;\n",
    "src/tag.js": "/**\n * @license MIT\n */\nexport const a = 1;\n",
    "src/expression.ts": "// SPDX-License-Identifier: (MIT AND BSD-3-Clause) OR GPL-2.0-only WITH Classpath-exception-2.0\nexport const a = 1;\n",
    "vendor/mit.ts": `${block(MIT)}\nexport const a = 1;\n`,
    "vendor/util.js": "// Reads the cache before the network.\nexport const a = 1;\n",
    "src/third-party.js": `// SPDX-License-Identifier: Apache-2.0\n${slashes(APACHE)}\nexport const a = 1;\n`,
  });
});

test("no-comments fails a copyright line or license notice in the repository's own code, and any prose with a license tag", (t) => {
  fails(
    t,
    {
      "src/a.ts": "export const a = 1;\n// SPDX-License-Identifier: MIT\n",
      "src/b.ts": "// SPDX-License-Identifier: MIT\nexport const b = 1;\n// explains\n",
      "src/c.ts": "// SPDX-License-Identifier: MIT\n// Explain the implementation.\nexport const c = 1;\n",
      "src/d.ts": "/**\n * @license MIT\n * Caches the parsed tree per file.\n */\nexport const d = 1;\n",
      "src/e.ts": `${block(MIT)}export const e = 1;\n`,
      "src/f.ts": "// SPDX-License-Identifier: MIT -- reads the cache first\nexport const f = 1;\n",
      "src/g.ts": "// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Someone: Explain the implementation.\nexport const g = 1;\n",
      "src/h.ts": "// SPDX-License-Identifier: MIT\n// SPDX-FileCopyrightText: 2024-2026 The Regents of the University of California\nexport const h = 1;\n",
      "src/i.ts": "// SPDX-License-Identifier: Cache OR clear OR parsed OR trees.\nexport const i = 1;\n",
      "src/j.ts": "// SPDX-License-Identifier: MIT WITH (Explain-the-implementation.)\nexport const j = 1;\n",
      "src/k.ts": "/** @license Explain-the-implementation. */\nexport const k = 1;\n",
      "src/l.ts": "// SPDX-License-Identifier: LicenseRef-Cache-the-parsed-tree-per-file\nexport const l = 1;\n",
      "src/m.ts": "// SPDX-License-Identifier: MIT WITH Apache-2.0\nexport const m = 1;\n",
    },
    `src/a.ts license: src/a.ts has a comment on line 2. ${LICENSE}`,
    `src/b.ts comment: src/b.ts has a comment on line 3. ${COMMENT}`,
    `src/c.ts comment: src/c.ts has a comment on line 2. ${COMMENT}`,
    `src/d.ts license: src/d.ts has a comment on line 1. ${LICENSE}`,
    `src/e.ts license: src/e.ts has a comment on line 1. ${LICENSE}`,
    `src/f.ts license: src/f.ts has a comment on line 1. ${LICENSE}`,
    `src/g.ts license: src/g.ts has a comment on line 2. ${LICENSE}`,
    `src/h.ts license: src/h.ts has a comment on line 2. ${LICENSE}`,
    `src/i.ts license: src/i.ts has a comment on line 1. ${LICENSE}`,
    `src/j.ts license: src/j.ts has a comment on line 1. ${LICENSE}`,
    `src/k.ts license: src/k.ts has a comment on line 1. ${LICENSE}`,
    `src/l.ts license: src/l.ts has a comment on line 1. ${LICENSE}`,
    `src/m.ts license: src/m.ts has a comment on line 1. ${LICENSE}`,
  );
});

test("no-comments skips next-env.d.ts and a file .gitattributes marks linguist-generated, and still reads a .d.ts", (t) => {
  passes(t, {
    ".gitattributes": "apps/api/worker-configuration.d.ts linguist-generated\nsrc/generated/** linguist-generated=true\n",
    "apps/web/next-env.d.ts": '/// <reference types="next" />\n// NOTE: This file should not be edited\n',
    "apps/api/worker-configuration.d.ts": "/* eslint-disable */\n// Generated by Wrangler by running `wrangler types`\ninterface Env {}\n",
    "src/generated/prisma.ts": "/* !!! This is code generated by Prisma. Do not edit directly. !!! */\n/* eslint-disable */\n// @ts-nocheck\nexport const a = 1;\n",
  });
});

test("no-comments reads a file whose own header claims it is generated", (t) => {
  fails(
    t,
    {
      ".gitattributes": "src/out.ts -linguist-generated\n",
      "src/schema.ts": "// @generated\n// Explain the implementation.\nexport const a = 1;\n",
      "src/go.ts": "// Code generated by protoc. DO NOT EDIT.\nexport const a = 1;\n",
      "src/out.ts": "/* This file was auto-generated by the client builder. */\nexport const a = 1;\n",
      "src/env.d.ts": '/// <reference types="vite/client" />\n',
    },
    `src/env.d.ts comment: src/env.d.ts has a comment on line 1. ${COMMENT}`,
    `src/go.ts comment: src/go.ts has a comment on line 1. ${COMMENT}`,
    `src/out.ts comment: src/out.ts has a comment on line 1. ${COMMENT}`,
    `src/schema.ts comment: src/schema.ts has comments on lines 1, 2. ${COMMENT}`,
  );
});

test("no-comments passes the swr template copied into a Next app", (t) => {
  passes(t, { "apps/web/src/lib/swr.ts": readFileSync(new URL("../templates/swr.ts", import.meta.url), "utf8") });
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

test("no-comments fails comments in an Astro component's frontmatter, scripts and markup", (t) => {
  fails(
    t,
    {
      "src/pages/index.astro": [
        "---",
        "// loads the page",
        "const title = 1;",
        "---",
        "<!-- markup note -->",
        "<p>// not a comment {title}</p>",
        "<script>",
        "  /* runs in the browser */",
        "  document.title = \"x\";",
        "</script>",
        "",
      ].join("\n"),
    },
    `src/pages/index.astro comment: src/pages/index.astro has comments on lines 2, 8. ${COMMENT}`,
    `src/pages/index.astro html-comment: src/pages/index.astro has a comment on line 5. ${HTML}`,
  );
});

test("no-comments reads Astro frontmatter past a fence line in a string, and skips script text in markup strings", (t) => {
  fails(
    t,
    {
      "src/pages/index.astro": [
        "---",
        "const example = `one",
        "---",
        "two`;",
        "// after the string",
        "---",
        '<p>{"<script>not javascript</script>"}</p>',
        '<div data-example="<script>not javascript</script>">{example}</div>',
        "",
      ].join("\n"),
    },
    `src/pages/index.astro comment: src/pages/index.astro has a comment on line 5. ${COMMENT}`,
  );
});

test("no-comments fails HTML comments and markup expression comments in an Astro component, and passes a pointer and a directive there", (t) => {
  fails(
    t,
    {
      "docs/layout.md": "# Layout\n\n## Font preloads\n",
      "src/pages/markup.astro": [
        "---",
        "const items = [1];",
        "---",
        "<!-- ships to visitors -->",
        "<!--",
        "  spans lines",
        "-->",
        "<!--[if IE]><p>old</p><![endif]-->",
        "<?prose in a bogus comment?>",
        '<p title="<!-- an attribute value -->">สวัสดี {/* in an expression */}</p>',
        "<ul>{items.map((item) => {",
        "  // inside the arrow",
        "  return <li>{/* nested */ item}</li>;",
        "})}</ul>",
        "<Card data={/* attribute */ 1} {/* spread */ ...items} label=`a${/* template */ 1}` slot={<i>{/* jsx */}</i>} />",
        "<noscript><!-- in noscript --></noscript>",
        "<pre is:raw><!-- raw --> {/* literal text */}</pre>",
        '<div set:html="<!-- injected -->"></div>',
        "<style>/* css */ p { color: red; }</style>",
        '<script type="application/ld+json">{"a": "/* data */"}</script>',
        "<title><!-- title text --></title>",
        '<div set:text="<!-- escaped text -->"></div>',
        "{/* See: docs/layout.md#font-preloads */}",
        "{/* oxlint-disable-next-line no-img-element -- intrinsic sizing */}",
        "<img />",
        "{/* See: docs/missing.md */}",
        "</ prose in an end tag>",
        "",
      ].join("\n"),
    },
    `src/pages/markup.astro html-comment: src/pages/markup.astro has comments on lines 4, 5, 8, 9, 16, 17, 18, 27. ${HTML}`,
    `src/pages/markup.astro comment: src/pages/markup.astro has comments on lines 10, 12, 13, 15. ${COMMENT}`,
    "src/pages/markup.astro doc-pointer: src/pages/markup.astro has a comment on line 26. Point at a tracked doc that matches docs/*.md or apps/*/docs/*.md, with a path from the repository root; docs/missing.md is not one.",
  );
});

test("no-comments gives the license fix only to a notice marker or a license header, not to prose that says license", (t) => {
  fails(
    t,
    {
      "src/a.ts": "// Validate the license field before saving the driver record.\nexport const a = 1;\n",
      "src/b.ts": "export const b = 1;\n// The driving licence number must have eight digits.\n",
      "src/c.ts": "// Copyright 2026 Someone\n// Licensed under the Apache License, Version 2.0.\n// Reads the cache first.\nexport const c = 1;\n",
      "src/d.ts": "export const d = 1;\n/* \u00a9 2026 Someone */\n",
    },
    `src/a.ts comment: src/a.ts has a comment on line 1. ${COMMENT}`,
    `src/b.ts comment: src/b.ts has a comment on line 2. ${COMMENT}`,
    `src/c.ts license: src/c.ts has comments on lines 1, 2. ${LICENSE}`,
    `src/c.ts comment: src/c.ts has a comment on line 3. ${COMMENT}`,
    `src/d.ts license: src/d.ts has a comment on line 2. ${LICENSE}`,
  );
});
