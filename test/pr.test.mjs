import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { check } from "../src/pr/check.mjs";

const BODY = `Ticket: SOL-1

## Summary

\`\`\`diff
- two PR shapes
+ one template, checked in CI
\`\`\`

## Evidence

- **Before:** \`standard-pr\` missing.
  **After:** \`standard-pr\` passes.

## Merge Danger

**Door:** two-way

**Blast Radius:** adopters
`;

const pull = { number: 7, body: BODY, bot: false, files: ["src/pr/check.mjs"], commits: ["a1"], open: [] };

test("a PR in the template passes", () => {
  deepEqual(check(pull), []);
});

test("PRs by a bot are skipped", () => {
  deepEqual(check({ ...pull, bot: true, body: "" }), []);
});

test("the body uses the template's three sections in order with no preamble", () => {
  deepEqual(check({ ...pull, body: "Hi\n\n## Why\n\nx\n" }), [
    "Body: start with ## Summary (after an optional Ticket: line); skip preambles.",
    "Body: use the template's sections once each, in order: ## Summary, ## Evidence, ## Merge Danger. Got ## Why.",
  ]);
});

test("each section carries what the template asks for", () => {
  const body =
    "## Summary\n\nWords only.\n\n## Evidence\n\nTests pass.\n\n## Merge Danger\n\n**Door:** maybe\n\nBlast Radius: many things\n";
  deepEqual(check({ ...pull, body }), [
    "Summary: add one visual, such as pseudocode, a call tree, a component tree, a file tree, a Mermaid diagram or a diff block.",
    "Evidence: show a Before: and an After: (screenshot, output or test).",
    "Merge Danger: add a line **Door:** one-way or **Door:** two-way.",
    "Merge Danger: add a line **Blast Radius:** <one word>, naming who or what the change can hurt.",
  ]);
});

test("a user-visible change shows screenshots or a recording in Evidence", () => {
  const ui = { ...pull, files: ["apps/web/src/app/page.tsx", "apps/web/src/app/page.test.tsx"] };
  deepEqual(check(ui), [
    "Evidence: apps/web/src/app/page.tsx is a user-visible change. Add screenshots or a recording.",
  ]);
  const shown = BODY.replace("**After:** `standard-pr` passes.", "**After:** ![after](https://example.com/after.png)");
  deepEqual(check({ ...ui, body: shown }), []);
  deepEqual(check({ ...pull, files: ["apps/web/src/app/page.test.tsx"] }), []);
});

test("a branch built on an unmerged PR names it", () => {
  const open = [{ number: 6, sha: "a1" }];
  deepEqual(check({ ...pull, open }), ["Body: this branch builds on unmerged #6. Name #6 in the PR."]);
  deepEqual(check({ ...pull, open, body: BODY.replace("Before:** ", "Before:** Builds on #6. ") }), []);
});
