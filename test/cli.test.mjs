import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { checkEvent, commit, git, linkPackage, standard, tempDir, tempRepo, tryGit, write } from "./helpers.mjs";

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
  assert.equal(stdout.trim(), "commit-subject: pending in .standard/config.json, so it did not run");
  assert.equal(status, 0);
});

test("the config fails on a key or a check this version does not know", (t) => {
  const cases = [
    [{ lint: {} }, /\.standard\/config\.json has an unknown key "lint"\. Known keys: api-modules, banned, boundaries, cached-modules, client-data, effect-wrappers, error-boundaries, hooks, pending, pr\./],
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
    [["nope"], /standard check names "nope", which is not a check in this version\. Checks: commit-subject, pr-title, pr-body, pr-screenshot, pr-size, baseline-growth, wiring, dead-code, duplicates, typecheck, tests, pr-tests, boundaries, banned, react, client-data, route-await, use-promise, suspense-errors, cache-components, no-comments, docs\./],
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
  const { stderr, status } = standard(tempRepo(t), ["deploy"]);
  assert.match(stderr, /Unknown command deploy\.\nUsage:\n {2}standard check/);
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
  assert.equal(
    written[0].replace(/^100755 \d+ /, ""),
    [
      "#!/bin/sh",
      'root="$(git rev-parse --show-toplevel)"',
      '[ -e "$root/node_modules/.bin/standard" ] || [ -e "$root/.standard/config.json" ] || exit 0',
      'exec "$root/node_modules/.bin/standard" hook commit-msg "$@"',
      "",
    ].join("\n"),
  );

  const second = standard(cwd, ["install"]);
  assert.equal(second.stdout, "standard install: hooks already up to date\n");
  assert.deepEqual(shims(cwd), written);
});

test("install outside a git work tree exits 0 and writes nothing, so a Docker build's pnpm install passes", (t) => {
  const cwd = tempDir(t, "image");
  const { stdout, stderr, status } = standard(cwd, ["install"], { env: { GIT_CEILING_DIRECTORIES: cwd } });
  assert.equal(stdout, "standard install: not inside a git work tree, so there are no hooks to install\n");
  assert.equal(stderr, "");
  assert.equal(status, 0);
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
  const cwd = tempRepo(t, {});
  linkPackage(cwd);
  standard(cwd, ["install"]);
  git(cwd, "add", ".standard");

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

test("a push from an adopted checkout without node_modules fails instead of skipping the hook", (t) => {
  const { cwd } = cloneWithRemote(t, {});
  commit(cwd, "Land another change");
  rmSync(join(cwd, "node_modules"), { recursive: true });
  const { stderr, status } = tryGit(cwd, "push", "origin", "develop");
  assert.match(stderr, /node_modules\/\.bin\/standard/);
  assert.notEqual(status, 0);
});

test("in one clone, a worktree that has not adopted skips the hooks and one that has fails without node_modules", (t) => {
  const origin = tempRepo(t);
  commit(origin, "Start the repository");
  git(origin, "branch", "before-adoption");
  write(origin, { ".standard/config.json": {} });
  git(origin, "add", ".standard");
  commit(origin, "Adopt the standard");

  const clone = join(tempDir(t, "clone"), "app");
  git(tempDir(t, "cwd"), "clone", "-q", origin, clone);
  linkPackage(clone);
  assert.equal(standard(clone, ["install"]).status, 0);
  assert.match(tryGit(clone, "commit", "--allow-empty", "-m", "fix stuff").stderr, /commit-msg: Subject does not start/);

  const old = join(tempDir(t, "worktree"), "old");
  git(clone, "worktree", "add", "-q", "-b", "old-work", old, "origin/before-adoption");
  const skipped = tryGit(old, "commit", "--allow-empty", "-m", "fix stuff");
  assert.equal(skipped.stderr, "");
  assert.equal(skipped.status, 0);
  assert.equal(git(old, "log", "-1", "--format=%s"), "fix stuff");

  const adopted = join(tempDir(t, "worktree"), "adopted");
  git(clone, "worktree", "add", "-q", "-b", "new-work", adopted, "origin/develop");
  const refused = tryGit(adopted, "commit", "--allow-empty", "-m", "Add the feature");
  assert.match(refused.stderr, /node_modules\/\.bin\/standard/);
  assert.notEqual(refused.status, 0);
  assert.equal(git(adopted, "log", "-1", "--format=%s"), "Adopt the standard");
});

test("the config names the kebab-case key for a camelCase key and lists the known keys for an unknown one", (t) => {
  const cases = [
    [{ pr: { ticketPrefix: "ABC" } }, '"ticketPrefix" in .standard/config.json is camelCase; name it "ticket-prefix".\n'],
    [{ hooks: { preCommit: [] } }, '"preCommit" in .standard/config.json is camelCase; name it "pre-commit".\n'],
    [{ pr: { screenshots: { whenChanged: [] } } }, '"whenChanged" in .standard/config.json is camelCase; name it "when-changed". Known keys: pr.screenshots.when, pr.screenshots.uploader.\n'],
    [{ boundaries: { zones: [] } }, '.standard/config.json has an unknown key "boundaries.zones". Known keys: boundaries.modules, boundaries.forbid.\n'],
    [{ boundaries: { modules: [{ folders: ["src/*"], entries: ["index"], openFolders: [] }] } }, '"openFolders" in .standard/config.json is camelCase; name it "open-folders". Known keys: boundaries.modules[0].folders, boundaries.modules[0].entries, boundaries.modules[0].open, boundaries.modules[0].except.\n'],
    [{ boundaries: { forbid: [{ files: ["a/**"], imports: ["b/**"], fix: "Do it." }], Modules: [] } }, '"Modules" in .standard/config.json is camelCase; name it "modules".\n'],
    [{ pr: { ticket_prefix: "ABC" } }, '.standard/config.json has an unknown key "pr.ticket_prefix". Known keys: pr.ticket-prefix, pr.screenshots.\n'],
  ];
  for (const [config, message] of cases) {
    const { stderr, status } = standard(tempRepo(t, config), ["check"]);
    assert.equal(stderr, `standard: ${message}`);
    assert.equal(status, 1);
  }
});

test("the config fails on a repeated key, at the top level or nested, and names where", (t) => {
  const cases = [
    ['{"pr":{"ticket-prefix":"ABC","mystery":true},"pr":{}}', "line 1, column 46"],
    ['{\n  "hooks": {\n    "pre-push": [],\n    "pre-push": ["x"]\n  }\n}\n', "line 4, column 5"],
  ];
  for (const [text, where] of cases) {
    const cwd = tempRepo(t);
    write(cwd, { ".standard/config.json": text });
    const { stderr, status } = commitMsg(cwd, "Add the login page\n");
    assert.equal(stderr, `standard: .standard/config.json repeats a key at ${where}. Keep one copy of each key.\n`);
    assert.equal(status, 1);
  }
});

test("a tracked root standard.json fails and says where the config moved", (t) => {
  const cwd = tempRepo(t);
  write(cwd, { "standard.json": { pending: ["commit-subject"] } });
  assert.equal(commitMsg(cwd, "fix stuff\n").status, 1);

  git(cwd, "add", "standard.json");
  const { stderr, status } = commitMsg(cwd, "Add the login page\n");
  assert.equal(stderr, "standard: standard.json is tracked at the repository root. Move it to .standard/config.json.\n");
  assert.equal(status, 1);
});

test("a symlinked config or config folder fails", (t) => {
  const file = tempRepo(t);
  write(file, { "elsewhere.json": {}, ".standard/baselines/.keep": "" });
  symlinkSync("../elsewhere.json", join(file, ".standard/config.json"));
  assert.equal(commitMsg(file, "Add the login page\n").stderr, "standard: .standard/config.json is a symlink. Make it a regular file, so every check reads the same config.\n");

  const folder = tempRepo(t);
  write(folder, { "elsewhere/config.json": {} });
  symlinkSync("elsewhere", join(folder, ".standard"));
  assert.equal(commitMsg(folder, "Add the login page\n").stderr, "standard: .standard is a symlink. Make it a regular folder, so every check reads the same config.\n");
});
