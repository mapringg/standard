import { deepEqual, equal, match } from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("the standalone check validates a shell-only repository", (t) => {
  const root = mkdtempSync(join(tmpdir(), "standard-pr-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "setup.sh"), "true\n");
  git("add", "setup.sh");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Add script");
  const head = git("rev-parse", "HEAD");

  const eventPath = join(root, "event.json");
  const run = (body, eventName = "pull_request") => {
    const event = pullRequest(body);
    event.pull_request.base.sha = base;
    event.pull_request.head.sha = head;
    writeFileSync(eventPath, JSON.stringify(event));
    return spawnSync(process.execPath, [join(import.meta.dirname, "../bin/check-pr.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath },
    });
  };

  const invalid = run("");
  equal(invalid.status, 1);
  match(invalid.stderr, /Body: start with ## Summary/);
  const valid = run(
    "## Summary\n\n```\nsetup script\n```\n\n## Evidence\n\nBefore: missing script\nAfter: shell syntax passes\n\n## Merge Danger\n\nDoor: two-way\nBlast Radius: setup\n",
  );
  equal(valid.status, 0, valid.stderr);
  equal(run("", "push").status, 0);
});
