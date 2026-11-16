import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { checkEvent, commit, git, linkPackage, standard, tempDir, tempRepo, tryGit } from "./helpers.mjs";

const HOOKS = ["commit-msg", "pre-commit", "pre-push"];

function commitMsg(cwd, message) {
  writeFileSync(join(cwd, "MESSAGE"), message);
  return standard(cwd, ["hook", "commit-msg", "MESSAGE"]);
}

test("hook commit-msg rejects a bad message and says how to fix it", (t) => {
  const { stderr, status } = commitMsg(tempRepo(t), "fix stuff\n");
  assert.equal(
    stderr,
    "commit-msg: Subject does not start with a capital letter.\ncommit-msg: Subject is too short to describe the change.\n",
  );
  assert.equal(status, 1);
});

test("hook commit-msg rejects a body and a trailer", (t) => {
  const cwd = tempRepo(t);
  for (const rest of ["It was missing.", "Co-Authored-By: someone <s@example.com>"]) {
    const { stderr, status } = commitMsg(cwd, `Add the login page\n\n${rest}\n`);
    assert.equal(
      stderr,
      "commit-msg: Commit has a body or trailer. Keep the subject line only, with no Co-Authored-By.\n",
    );
    assert.equal(status, 1);
  }
});

test("hook commit-msg accepts a good message and ignores what git strips", (t) => {
  const cwd = tempRepo(t);
  const verbose = [
    "Add the login page",
    "",
    "# Please enter the commit message for your changes.",
    "# ------------------------ >8 ------------------------",
    "diff --git a/login.ts b/login.ts",
    "+fixed the build.",
  ].join("\n");
  for (const message of ["Add the login page\n", verbose]) {
    const { stderr, status } = commitMsg(cwd, message);
    assert.equal(stderr, "");
    assert.equal(status, 0);
  }
});

test("the commit hook accepts a good message while a pull request check is pending", (t) => {
  const cwd = tempRepo(t, { pending: ["pr-body"] });
  const { stderr, status } = commitMsg(cwd, "Add the login page\n");
  assert.equal(stderr, "");
  assert.equal(status, 0);
});

test("a pending check does not run, in a hook or in CI", (t) => {
  const cwd = tempRepo(t, { pending: ["commit-subject"] });
  assert.equal(commitMsg(cwd, "fix stuff\n").status, 0);

  const before = commit(cwd, "Start the repository");
  const after = commit(cwd, "wip");
  const { stdout, status } = checkEvent(t, cwd, { ref: "refs/heads/develop", before, after }, ["commit-subject"]);
  assert.equal(stdout.trim(), "commit-subject: pending in standard.json, so it did not run");
  assert.equal(status, 0);
});

test("standard.json fails on a key or a check this version does not know", (t) => {
  const cases = [
    [{ lint: {} }, /standard\.json has an unknown key "lint"\. Known keys: hooks, pending, pr\./],
    [{ hooks: { "post-merge": [] } }, /unknown key "hooks\.post-merge"\. Known keys: hooks\.pre-commit, hooks\.pre-push\./],
    [{ hooks: { "pre-push": "pnpm test" } }, /hooks\.pre-push must be a list of non-empty strings/],
    [{ pending: ["commit-subjects"] }, /pending names "commit-subjects", which is not a check in this version/],
  ];
  for (const [config, expected] of cases) {
    const { stderr, status } = commitMsg(tempRepo(t, config), "Add the login page\n");
    assert.match(stderr, expected);
    assert.equal(status, 1);
  }
});

test("check refuses an unknown name, an unknown flag, and a ratchet flag on a commit check", (t) => {
  const cwd = tempRepo(t);
  const cases = [
    [["nope"], /standard check names "nope", which is not a check in this version\. Checks: commit-subject, pr-title, pr-body, pr-screenshot, baseline-growth\./],
    [["--nope"], /Unexpected argument --nope\. Use --pr <number> or one of --init, --write, --prune\./],
    [["commit-subject", "--write"], /--write changes one baseline, so name exactly one tree check/],
  ];
  for (const [args, expected] of cases) {
    const { stderr, status } = standard(cwd, ["check", ...args]);
    assert.match(stderr, expected);
    assert.equal(status, 1);
  }
});

test("an unknown command prints the usage", (t) => {
  const { stderr, status } = standard(tempRepo(t), ["merge"]);
  assert.match(stderr, /Unknown command merge\.\nUsage:\n {2}standard check/);
  assert.equal(status, 1);
});

function shims(cwd) {
  return HOOKS.map((hook) => {
    const path = join(cwd, ".git/hooks", hook);
    return `${statSync(path).mode.toString(8)} ${statSync(path).ino} ${readFileSync(path, "utf8")}`;
  });
}

test("install writes the same shims every time and unsets core.hooksPath", (t) => {
  const cwd = tempRepo(t);
  git(cwd, "config", "core.hooksPath", ".husky/_");

  const first = standard(cwd, ["install"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /wrote .*hooks\/commit-msg\n.*wrote .*hooks\/pre-commit\n.*wrote .*hooks\/pre-push\n.*unset core\.hooksPath/);
  assert.equal(tryGit(cwd, "config", "--get", "core.hooksPath").stdout, "");
  const written = shims(cwd);
  assert.match(written[0], /^100755 \d+ #!\/bin\/sh\nexec "\$\(git rev-parse --show-toplevel\)\/node_modules\/\.bin\/standard" hook commit-msg "\$@"\n$/);

  const second = standard(cwd, ["install"]);
  assert.equal(second.stdout, "standard install: hooks already up to date\n");
  assert.deepEqual(shims(cwd), written);
});

test("install unsets an empty core.hooksPath, which would otherwise skip the hooks", (t) => {
  const cwd = tempRepo(t);
  git(cwd, "config", "core.hooksPath", "");

  const { stdout, status } = standard(cwd, ["install"]);
  assert.equal(status, 0);
  assert.match(stdout, /unset core\.hooksPath/);
  assert.equal(tryGit(cwd, "config", "--get", "core.hooksPath").status, 1);
});

test("install replaces a hook that is not the shim and one that lost its executable bit", (t) => {
  const cwd = tempRepo(t);
  standard(cwd, ["install"]);
  const path = join(cwd, ".git/hooks/commit-msg");
  const shim = readFileSync(path, "utf8");

  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  assert.match(standard(cwd, ["install"]).stdout, /^standard install: wrote .*commit-msg\n$/);
  assert.equal(readFileSync(path, "utf8"), shim);

  chmodSync(path, 0o644);
  assert.match(standard(cwd, ["install"]).stdout, /^standard install: wrote .*commit-msg\n$/);
  assert.equal(statSync(path).mode & 0o777, 0o755);
});

test("install refuses when core.hooksPath is set outside the repo", (t) => {
  const cwd = tempRepo(t);
  const global = join(tempDir(t, "global"), "gitconfig");
  writeFileSync(global, "[core]\n\thooksPath = /elsewhere\n");
  const { stderr, status } = standard(cwd, ["install"], { env: { GIT_CONFIG_GLOBAL: global } });
  assert.match(stderr, /core\.hooksPath is still \/elsewhere outside this repo's config/);
  assert.equal(status, 1);
});

test("the installed shim checks a real commit, in the main checkout and in a fresh worktree", (t) => {
  const cwd = tempRepo(t);
  linkPackage(cwd);
  standard(cwd, ["install"]);

  const bad = tryGit(cwd, "commit", "--allow-empty", "-m", "fix stuff");
  assert.match(bad.stderr, /commit-msg: Subject does not start with a capital letter\./);
  assert.equal(bad.status, 1);
  assert.equal(tryGit(cwd, "commit", "-q", "--allow-empty", "-m", "Start the repository").status, 0);

  const worktree = join(tempDir(t, "worktree"), "feature");
  git(cwd, "worktree", "add", "-q", "-b", "feature", worktree);
  const unlinked = tryGit(worktree, "commit", "--allow-empty", "-m", "Add the feature");
  assert.match(unlinked.stderr, /node_modules\/\.bin\/standard/);
  assert.notEqual(unlinked.status, 0);

  linkPackage(worktree);
  const rejected = tryGit(worktree, "commit", "--allow-empty", "-m", "added the feature");
  assert.match(rejected.stderr, /commit-msg: Subject starts with "added"/);
  assert.equal(rejected.status, 1);
  assert.equal(tryGit(worktree, "commit", "-q", "--allow-empty", "-m", "Add the feature").status, 0);
  assert.equal(git(worktree, "log", "-1", "--format=%s"), "Add the feature");
});

test("hook pre-commit runs the repo's lines in order and stops at the first failure", (t) => {
  const cwd = tempRepo(t, { hooks: { "pre-commit": ["echo first >> ran", "exit 3", "echo third >> ran"] } });
  linkPackage(cwd);
  standard(cwd, ["install"]);
  const { stderr, status } = tryGit(cwd, "commit", "--allow-empty", "-m", "Start the repository");
  assert.match(stderr, /pre-commit: "exit 3" failed, so the later lines did not run\./);
  assert.equal(status, 1);
  assert.equal(readFileSync(join(cwd, "ran"), "utf8"), "first\n");
  assert.equal(tryGit(cwd, "rev-parse", "HEAD").status, 128);
});

function cloneWithRemote(t, config) {
  const remote = tempDir(t, "remote");
  git(remote, "init", "-q", "--bare", "-b", "develop");
  const cwd = tempRepo(t, config);
  git(cwd, "remote", "add", "origin", remote);
  commit(cwd, "Start the repository");
  git(cwd, "push", "-q", "-u", "origin", "develop");
  linkPackage(cwd);
  standard(cwd, ["install"]);
  return { cwd, remote };
}

test("hook pre-push refuses a merge commit that origin/develop lacks", (t) => {
  const { cwd, remote } = cloneWithRemote(t, { hooks: { "pre-push": ["echo ran > ran"] } });
  git(cwd, "switch", "-q", "-c", "feature");
  commit(cwd, "Add the feature");
  git(cwd, "switch", "-q", "develop");
  commit(cwd, "Land another change");
  git(cwd, "switch", "-q", "feature");
  git(cwd, "merge", "-q", "--no-ff", "--no-verify", "develop", "-m", "Merge branch 'develop' into feature");

  const { stderr, status } = tryGit(cwd, "push", "origin", "feature");
  assert.match(
    stderr,
    /pre-push: refs\/heads\/feature has merge commits that origin\/develop lacks\. Drop them: rebase onto the pull request's base branch and push with --force-with-lease\.\n\w{7} Merge branch 'develop' into feature/,
  );
  assert.equal(status, 1);
  assert.equal(git(remote, "branch", "--list", "feature"), "");
  assert.equal(existsSync(join(cwd, "ran")), false);

  assert.equal(tryGit(cwd, "push", "origin", "develop:refs/heads/old").status, 0);
  assert.equal(tryGit(cwd, "push", "origin", "--delete", "old").status, 0);
  assert.equal(git(remote, "branch", "--list", "old"), "");
});

test("hook pre-push lets a linear branch through, then runs the repo's lines", (t) => {
  const { cwd, remote } = cloneWithRemote(t, { hooks: { "pre-push": ["echo ran > ran", "test -f allow"] } });
  git(cwd, "switch", "-q", "-c", "feature");
  commit(cwd, "Add the feature");

  const blocked = tryGit(cwd, "push", "origin", "feature");
  assert.match(blocked.stderr, /pre-push: "test -f allow" failed/);
  assert.equal(blocked.status, 1);
  assert.equal(readFileSync(join(cwd, "ran"), "utf8"), "ran\n");
  assert.equal(git(remote, "branch", "--list", "feature"), "");

  writeFileSync(join(cwd, "allow"), "");
  assert.equal(tryGit(cwd, "push", "origin", "feature").status, 0);
  assert.match(git(remote, "branch", "--list", "feature"), /feature/);
});

test("hook pre-push does not look for merge commits in a push to develop or main", (t) => {
  const { cwd, remote } = cloneWithRemote(t);
  git(cwd, "switch", "-q", "-c", "feature");
  commit(cwd, "Add the feature");
  git(cwd, "switch", "-q", "develop");
  commit(cwd, "Land another change");
  git(cwd, "merge", "-q", "--no-ff", "--no-verify", "feature", "-m", "Merge branch 'feature' into develop");
  assert.equal(tryGit(cwd, "push", "origin", "develop:main").status, 0);
  assert.match(git(remote, "branch", "--list", "main"), /main/);
});

test("a push from a checkout without node_modules fails instead of skipping the hook", (t) => {
  const { cwd } = cloneWithRemote(t);
  commit(cwd, "Land another change");
  rmSync(join(cwd, "node_modules"), { recursive: true });
  const { stderr, status } = tryGit(cwd, "push", "origin", "develop");
  assert.match(stderr, /node_modules\/\.bin\/standard/);
  assert.notEqual(status, 0);
});
