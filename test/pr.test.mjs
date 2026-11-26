import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { check } from "../src/plugin/pr-check.mjs";

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

const pull = {
  number: 7,
  title: "Check PR titles in pnpm lint",
  body: BODY,
  bot: false,
};

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

test("evidence accepts output and visual attachments", () => {
  const shown = BODY.replace("**After:** `standard-pr` passes.", "**After:** ![after](https://example.com/after.png)");
  deepEqual(check({ ...pull, body: shown }), []);
  const output = BODY.replace("**After:** `standard-pr` passes.", "**After:**\n\n```text\n1 passed\n```");
  deepEqual(check({ ...pull, body: output }), []);
});

test("evidence requires both entries to contain proof", () => {
  const after = "**After:** `standard-pr` passes.";
  const missing = ["**After:**", "**After:** <!-- add proof -->", "**After:** <screenshot/output/passing test run>"];
  for (const entry of missing) {
    deepEqual(check({ ...pull, body: BODY.replace(after, entry) }), [
      "Evidence: show a Before: and an After: (screenshot, output or test).",
    ]);
  }
});

test("the title is one plain sentence that fits the squash subject", () => {
  deepEqual(check({ ...pull, title: "feat(pr): check titles." }), [
    "Title: drop the type(scope): prefix and write one plain sentence.",
    "Title: drop the trailing period.",
  ]);
  deepEqual(check({ ...pull, title: "check titles" }), [
    "Title: start with a capitalised verb, such as Allow, Fix or Remove.",
  ]);
  deepEqual(check({ ...pull, title: `Allow ${"x".repeat(70)}` }), [
    'Title: shorten to 80 characters including " (#7)". It is 81.',
  ]);
  deepEqual(check({ ...pull, title: `Allow ${"x".repeat(69)}` }), []);
});
