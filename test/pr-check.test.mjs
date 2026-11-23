import { deepEqual } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const files = {
  "apps/web/src/lib/log.ts": "export const a = 1;\n",
  "apps/web/src/lib/time.ts": "export const b = 1;\n",
};

function findings(t, event) {
  const path = join(tmpdir(), `standard-event-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(event));
  t.after(() => {
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_EVENT_PATH;
  });
  process.env.GITHUB_EVENT_NAME = "pull_request";
  process.env.GITHUB_EVENT_PATH = path;
  return only(lint(t, files), "pr-check").map((item) => `${item.file}: ${item.message}`);
}

const pullRequest = (body, type = "User") => ({
  pull_request: { number: 7, title: "Allow a test", body, user: { type }, base: { sha: "a" }, head: { sha: "b" } },
});

test("pr-check reports a PR body outside the template once, in CI", (t) => {
  deepEqual(
    findings(
      t,
      pullRequest(
        "## Summary\n\n```\nx\n```\n\n## Evidence\n\nok\n\n## Merge Danger\n\n**Door:** two-way\n\n**Blast Radius:** none\n",
      ),
    ),
    ["apps/web/src/lib/log.ts: Evidence: show a Before: and an After: (screenshot, output or test)."],
  );
});

test("pr-check skips a PR by a bot", (t) => {
  deepEqual(findings(t, pullRequest("", "Bot")), []);
});

test("pr-check is silent outside a pull request", (t) => {
  deepEqual(only(lint(t, files), "pr-check"), []);
});
