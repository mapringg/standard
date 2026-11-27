import { deepEqual, equal, match } from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const files = {
  "README.md": "# Example\n\nExercises the standard.\n\n## Quick start\n\nRun the check.\n",
  "AGENTS.md": "# AGENTS.md\n\n## Rules\n\n- Run the check.\n",
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
  const body =
    "## Summary\n\n```\nsetup script\n```\n\n## Evidence\n\nBefore: missing script\nAfter: shell syntax passes\n\n## Merge Danger\n\nDoor: two-way\nBlast Radius: setup\n";
  writeFileSync(join(root, "AGENTS.md"), files["AGENTS.md"]);
  writeFileSync(join(root, "README.md"), "Setup steps\n");
  const missing = run(body);
  equal(missing.status, 1);
  match(missing.stderr, /README\.md:1: Start with a # heading naming the project\./);
  writeFileSync(join(root, "README.md"), files["README.md"]);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "AGENTS.md"), files["AGENTS.md"]);
  const valid = run(body);
  equal(valid.status, 0, valid.stderr);
  writeFileSync(join(root, "nested", "README.md"), files["README.md"]);
  writeFileSync(join(root, "nested", "AGENTS.md"), "# Wrong\n\n## Rules\n\n- Run the check.\n  From the repo root.\n");
  const drift = run(body);
  equal(drift.status, 1);
  match(drift.stderr, /nested\/AGENTS\.md:1: Start with # AGENTS\.md\./);
  match(drift.stderr, /nested\/AGENTS\.md:6: Use ## Rules/);
  match(drift.stderr, /nested\/README\.md:1: Keep the repository's README\.md at the root\./);
  const link = "[Workflow](https://example.com/" + "a".repeat(150) + ")";
  writeFileSync(join(root, "nested", "AGENTS.md"), files["AGENTS.md"] + "- Follow " + link + ".\n");
  rmSync(join(root, "nested", "README.md"));
  equal(run(body).status, 0);
  writeFileSync(join(root, "README.md"), files["README.md"] + "\n" + "a".repeat(50) + "\n" + "b".repeat(50) + "\n");
  const length = run(body);
  equal(length.status, 1);
  match(length.stderr, /README\.md:9: Shorten this text to 100 visible characters \(currently 101\)/);
  writeFileSync(join(root, "README.md"), files["README.md"]);
  writeFileSync(join(root, "nested", "AGENTS.md"), files["AGENTS.md"] + "<!-- BEGIN:broken -->\n");
  match(run(body).stderr, /Remove handwritten comments/);
  equal(run("", "push").status, 0);
});
