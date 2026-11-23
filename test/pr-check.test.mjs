import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const files = {
  "apps/web/src/lib/log.ts": "export const a = 1;\n",
  "node_modules/@mapringg/standard/package.json": '{"name":"@mapringg/standard"}',
};

function findings(t, extra) {
  return only(lint(t, { ...files, ...extra }), "pr-check").map((item) => item.message);
}

test("pr-check asks adopters to run standard-pr once", (t) => {
  deepEqual(findings(t, { ".github/workflows/ci.yml": "on: push\n" }), [
    "Run `pnpm exec standard-pr` with GITHUB_TOKEN in a pull_request workflow that also triggers on edited; see the standard README.",
  ]);
});

test("pr-check accepts a workflow that runs standard-pr", (t) => {
  deepEqual(findings(t, { ".github/workflows/pr.yaml": "steps:\n  - run: pnpm exec standard-pr\n" }), []);
});
