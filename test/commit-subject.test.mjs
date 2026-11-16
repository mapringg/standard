import assert from "node:assert/strict";
import { test } from "node:test";

import commitSubject from "../src/checks/commit-subject.mjs";
import { checkEvent, commit, eventFile, git, pullRequestEvent, standard, tempRepo } from "./helpers.mjs";

function fixes(subject, { body = "", source = "message", parents = 1 } = {}) {
  return commitSubject
    .run({ sha: null, subject, body, parents, source })
    .map((finding) => finding.fix)
    .join("\n");
}

const RULES = [
  ["", /Subject is empty/],
  [`Add ${"a very long name ".repeat(5)}`.trim(), /Subject is 88 characters; keep it to 80 or fewer/],
  ["feat: add the login page", /carries a "feat:" prefix/],
  ["Fix(api)!: drop the old route", /carries a "Fix\(api\)!:" prefix/],
  ["ABC-123", /only a ticket id/],
  ["sol 123", /only a ticket id/],
  ["Add the login page.", /ends with a period/],
  ["add the login page", /does not start with a capital letter/],
  ["Fixed the build", /starts with "Fixed"\. Use the imperative/],
  ["Adding the login page", /starts with "Adding"/],
  ["Makes the build pass", /starts with "Makes"/],
  ["WIP on login", /starts with "WIP"/],
  ["Fix build", /too short to describe the change/],
];

for (const [subject, expected] of RULES) {
  test(`rejects the subject "${subject.slice(0, 40)}"`, () => {
    assert.match(fixes(subject), expected);
  });
}

test("accepts a subject that follows every rule, at exactly 80 characters too", () => {
  assert.equal(fixes("Run the repository script tests in CI"), "");
  assert.equal(fixes(`Add ${"x".repeat(72)} now`), "");
  assert.equal(fixes("Add the squash number (#12)"), "");
});

test("rejects a body and a trailer", () => {
  assert.match(fixes("Add the login page", { body: "\nIt was missing." }), /has a body or trailer/);
  assert.match(
    fixes("Add the login page", { body: "\nCo-Authored-By: someone" }),
    /has a body or trailer/,
  );
});

for (const subject of [
  "Merge branch 'develop' into t3/ci",
  "Merge branch 'main' into t3/ci",
  "fixup! Add the login page",
  "squash! Add the login page",
  "amend! Add the login page",
]) {
  test(`leaves the subject git wrote alone: ${subject}`, () => {
    assert.equal(fixes(subject, { body: "\n# Conflicts:" }), "");
  });
}

function pullRequest(base, head) {
  return pullRequestEvent({ base, head });
}

function push(ref, before, after) {
  return { ref, before, after };
}

test("passes pull request commits that follow the convention", (t) => {
  const cwd = tempRepo(t);
  const base = commit(cwd, "Start the repository");
  commit(cwd, "Run the repository script tests in CI");
  const head = commit(cwd, "Merge branch 'develop' into t3/ci");
  const { stdout, status } = checkEvent(t, cwd, pullRequest(base, head), ["commit-subject"]);
  assert.equal(stdout.trim(), "commit-subject: OK (2 commit(s))");
  assert.equal(status, 0);
});

test("names the pull request commit and the rule it breaks, as a warning", (t) => {
  const cwd = tempRepo(t);
  const base = commit(cwd, "Start the repository");
  const head = commit(cwd, "Fixed the build");
  const { stdout, status } = checkEvent(t, cwd, pullRequest(base, head), ["commit-subject"]);
  assert.match(
    stdout,
    new RegExp(`::warning title=commit-subject::${head.slice(0, 7)} Fixed the build: Subject starts with "Fixed"`),
  );
  assert.equal(status, 0);
});

test("flags a body or trailer on a pull request commit", (t) => {
  const cwd = tempRepo(t);
  const base = commit(cwd, "Start the repository");
  const head = commit(cwd, "Run the repository script tests in CI\n\nCo-Authored-By: someone");
  const { stdout } = checkEvent(t, cwd, pullRequest(base, head));
  assert.match(stdout, /::warning title=commit-subject::.*Commit has a body or trailer/);
});

test("fails when it reads no commits", (t) => {
  const cwd = tempRepo(t);
  const only = commit(cwd, "Start the repository");
  const { stdout, status } = checkEvent(t, cwd, pullRequest(only, only));
  assert.match(stdout, /::error title=commit-subject::Read no commits/);
  assert.equal(status, 1);
});

test("fails when the clone lacks the pull request's commits", (t) => {
  const cwd = tempRepo(t);
  const only = commit(cwd, "Start the repository");
  const { stderr, status } = checkEvent(t, cwd, pullRequest("1".repeat(40), only));
  assert.match(stderr, /standard: Commit 1{40} of pull request #123 is not in this clone\. Check out with fetch-depth: 0\./);
  assert.equal(status, 1);
});

function repoWithMergeCommit(t, trunk) {
  const cwd = tempRepo(t);
  git(cwd, "switch", "-q", "-c", trunk);
  commit(cwd, "Start the repository");
  git(cwd, "switch", "-q", "-c", "feature");
  commit(cwd, "Add the feature");
  git(cwd, "switch", "-q", trunk);
  commit(cwd, "Land another change");
  git(cwd, "switch", "-q", "feature");
  git(cwd, "merge", "-q", "--no-ff", trunk, "-m", `Merge branch '${trunk}' into feature`);
  return cwd;
}

for (const trunk of ["develop", "main"]) {
  test(`fails on a merge commit in a pull request into ${trunk}, though other drift only warns`, (t) => {
    const cwd = repoWithMergeCommit(t, trunk);
    const event = pullRequest(git(cwd, "rev-parse", trunk), git(cwd, "rev-parse", "feature"));
    const { stdout, status } = checkEvent(t, cwd, event);
    assert.match(
      stdout,
      new RegExp(`::error title=commit-subject::\\w{7} Merge branch '${trunk}' into feature: .*rebase`),
    );
    assert.equal(status, 1);
  });

  test(`passes a linear range on ${trunk}`, (t) => {
    const cwd = repoWithMergeCommit(t, trunk);
    const event = pullRequest(git(cwd, "rev-parse", `${trunk}^`), git(cwd, "rev-parse", trunk));
    const { stdout, status } = checkEvent(t, cwd, event, ["commit-subject"]);
    assert.equal(stdout.trim(), "commit-subject: OK (1 commit(s))");
    assert.equal(status, 0);
  });

  test(`fails a push to ${trunk} whose subject breaks a rule or lacks its PR number`, (t) => {
    const cwd = tempRepo(t);
    const before = commit(cwd, "Start the repository");
    const drift = commit(cwd, "wip");
    const after = commit(cwd, "Add the feature");
    const { stdout, status } = checkEvent(t, cwd, push(`refs/heads/${trunk}`, before, after));
    assert.match(stdout, new RegExp(`::error title=commit-subject::${drift.slice(0, 7)} wip: Subject starts with "wip"`));
    assert.match(
      stdout,
      new RegExp(`::error title=commit-subject::${after.slice(0, 7)} Add the feature: Squash subject must end with its PR number`),
    );
    assert.equal(status, 1);
  });

  test(`passes a push of squash commits to ${trunk}`, (t) => {
    const cwd = tempRepo(t);
    const before = commit(cwd, "Start the repository");
    commit(cwd, "Add the feature (#12)");
    const after = commit(cwd, "Fix the build on a clean clone (#13)");
    const { stdout, status } = checkEvent(t, cwd, push(`refs/heads/${trunk}`, before, after), ["commit-subject"]);
    assert.equal(stdout.trim(), "commit-subject: OK (2 commit(s))");
    assert.equal(status, 0);
  });

  test(`fails a merge commit pushed to ${trunk}`, (t) => {
    const cwd = repoWithMergeCommit(t, trunk);
    const before = git(cwd, "rev-parse", trunk);
    const after = git(cwd, "rev-parse", "feature");
    const { stdout, status } = checkEvent(t, cwd, push(`refs/heads/${trunk}`, before, after));
    assert.match(stdout, /::error title=commit-subject::\w{7} Merge branch .*one-parent squash commits/);
    assert.equal(status, 1);
  });
}

test("fails a root commit pushed to develop, since trunk takes one-parent squash commits", (t) => {
  const cwd = tempRepo(t);
  const before = commit(cwd, "Start the repository");
  git(cwd, "checkout", "-q", "--orphan", "replacement");
  const after = commit(cwd, "Replace the entire history (#99)");
  const { stdout, status } = checkEvent(t, cwd, push("refs/heads/develop", before, after));
  assert.match(stdout, /Replace the entire history \(#99\).*one-parent squash commits/);
  assert.equal(status, 1);
});

test("a trunk squash subject meets the title rules on the part before its PR number, with no generated exemption", () => {
  const trunk = (subject) => fixes(subject, { source: "trunk" });
  assert.match(trunk("Fix the build. (#123)"), /ends with a period/);
  assert.match(trunk("Fix build (#123)"), /too short to describe the change/);
  assert.match(trunk("fixup! Fix the build (#123)"), /does not start with a capital letter/);
  assert.match(trunk(`Merge ${"the long branch name ".repeat(5)}(#123)`), /characters with the " \(#123\)" the squash adds/);
  assert.equal(trunk("Fix the flaky login test (#123)"), "");
  assert.equal(fixes("fixup! Fix the build"), "");
});

test("a push to any other branch gets the pull request rules", (t) => {
  const cwd = tempRepo(t);
  const before = commit(cwd, "Start the repository");
  const after = commit(cwd, "Fixed the build");
  const { stdout, status } = checkEvent(t, cwd, push("refs/heads/feature", before, after), ["commit-subject"]);
  assert.match(stdout, /::warning title=commit-subject::\w{7} Fixed the build: Subject starts with "Fixed"/);
  assert.equal(status, 0);
});

test("a created branch and an event without commits have nothing to check", (t) => {
  const cwd = tempRepo(t);
  const after = commit(cwd, "wip");
  for (const event of [push("refs/heads/feature", "0".repeat(40), after), { schedule: "0 0 * * *" }]) {
    const { stdout, status } = checkEvent(t, cwd, event, ["commit-subject"]);
    assert.equal(stdout.trim(), "commit-subject: skipped, this run has no commits to check");
    assert.equal(status, 0);
  }
});

test("prints plain lines outside GitHub Actions", (t) => {
  const cwd = tempRepo(t);
  const before = commit(cwd, "Start the repository");
  const after = commit(cwd, "wip");
  const path = eventFile(t, push("refs/heads/develop", before, after));
  const { stdout, status } = standard(cwd, ["check"], { env: { GITHUB_EVENT_PATH: path } });
  assert.match(stdout, new RegExp(`^commit-subject: ${after.slice(0, 7)} wip: Subject starts with "wip"`, "m"));
  assert.equal(status, 1);
});
