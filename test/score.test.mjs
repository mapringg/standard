import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";

import { git, installPackage, standard, tempDir, tempRepo, WIRED, write } from "./helpers.mjs";

function repoWith(t, files, config) {
  const cwd = tempRepo(t);
  write(cwd, { ...files, ...(config ? { ".standard/config.json": config } : {}) });
  git(cwd, "add", "-A");
  installPackage(cwd);
  assert.equal(standard(cwd, ["install"]).status, 0);
  return cwd;
}

function scoreJson(cwd, args, env) {
  const { stdout, stderr, status } = standard(cwd, ["score", "--json", ...args], { env });
  assert.equal(stderr, "");
  return { status, repos: JSON.parse(stdout).repos };
}

const statuses = (repo) => Object.fromEntries(repo.cells.map((cell) => [cell.row, cell.status]));

const GOOD_SETTINGS = {
  default_branch: "develop",
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "BLANK",
  delete_branch_on_merge: true,
};

function fakeGh(t, settings, tags = ["v0.3.0", "v0.4.0", "latest"]) {
  const bin = tempDir(t, "bin");
  const calls = join(bin, "calls");
  const script = `#!/usr/bin/env node
const { appendFileSync } = process.getBuiltinModule("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
console.log(args.includes("repos/mapringg/standard/tags") ? ${JSON.stringify(tags.join("\n"))} : ${JSON.stringify(JSON.stringify(settings))});
`;
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return {
    env: { PATH: `${bin}:${process.env.PATH}` },
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
  };
}

test("score prints one column for this repo and ends with its count", (t) => {
  const cwd = repoWith(t, { ...WIRED, "scripts/check-commit-msg.mjs": "old" });
  const name = basename(cwd);
  const { stdout, status } = standard(cwd, ["score"]);
  assert.equal(
    stdout,
    [
      `                   ${name}`,
      "wiring",
      "  retired          fail",
      "  ci               ok",
      "  pin              ok",
      "  installed        ok",
      "  prepare          ok",
      "  config-file      ok",
      "  claude-md        ok",
      "  hooks            ok",
      "  config           ok",
      "checks",
      "  commit-subject   on",
      "  pr-title         on",
      "  pr-body          on",
      "  pr-screenshot    n/a",
      "  pr-size          on",
      "  baseline-growth  on",
      "  wiring           on",
      "",
      `retired in ${name}: Delete scripts/check-commit-msg.mjs, which the commit-subject check replaces.`,
      `pr-screenshot in ${name}: n/a, .standard/config.json sets no pr.screenshots`,
      "",
      `${name}: 14 of 15 pass`,
      "",
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("an n/a row leaves the denominator, and a row that applies joins it", (t) => {
  const { status, repos } = scoreJson(repoWith(t, WIRED), []);
  assert.deepEqual(
    repos[0].cells.find((cell) => cell.row === "pr-screenshot"),
    { group: "checks", row: "pr-screenshot", status: "n/a", pass: null, notes: [".standard/config.json sets no pr.screenshots"] },
  );
  assert.deepEqual([repos[0].passing, repos[0].total], [15, 15]);
  assert.equal(status, 0);

  const screenshots = { pr: { screenshots: { when: ["web/**"], uploader: "scripts/upload.mjs" } } };
  const applied = scoreJson(repoWith(t, WIRED, screenshots), []);
  assert.equal(statuses(applied.repos[0])["pr-screenshot"], "on");
  assert.deepEqual([applied.repos[0].passing, applied.repos[0].total], [16, 16]);
});

test("pending stays in the denominator and fails", (t) => {
  const { status, repos } = scoreJson(repoWith(t, { ...WIRED, "scripts/check-pr-convention.mjs": "old" }, { pending: ["pr-body"] }), []);
  assert.equal(statuses(repos[0])["pr-body"], "pending");
  assert.equal(statuses(repos[0]).retired, "ok");
  assert.deepEqual([repos[0].passing, repos[0].total], [14, 15]);
  assert.equal(status, 1);
});

test("a pending check shows pending and fails even where it would not apply", (t) => {
  const { status, repos } = scoreJson(repoWith(t, WIRED, { pending: ["pr-screenshot"] }), []);
  assert.deepEqual(repos[0].cells.find((cell) => cell.row === "pr-screenshot"), {
    group: "checks",
    row: "pr-screenshot",
    status: "pending",
    pass: false,
    notes: [".standard/config.json pending lists it, so it does not run."],
  });
  assert.deepEqual([repos[0].passing, repos[0].total], [15, 16]);
  assert.equal(status, 1);
});

test("a pending list the runner refuses fails the config row with the runner's message", (t) => {
  const cases = [
    [{ pending: ["typo"] }, '.standard/config.json pending names "typo", which is not a check in this version. Checks: commit-subject, pr-title, pr-body, pr-screenshot, pr-size, baseline-growth, wiring.'],
    [{ pending: ["baseline-growth"] }, ".standard/config.json pending names baseline-growth, which guards pending itself. Remove it from pending."],
  ];
  for (const [config, message] of cases) {
    const cwd = repoWith(t, WIRED, config);
    const check = standard(cwd, ["check"]);
    assert.equal(check.stderr, `standard: ${message}\n`);
    assert.equal(check.status, 1);
    const { status, repos } = scoreJson(cwd, []);
    assert.deepEqual(repos[0].cells.find((cell) => cell.row === "config"), {
      group: "wiring",
      row: "config",
      status: "fail",
      pass: false,
      notes: [message],
    });
    assert.equal(status, 1);
  }
});

test("hooks fails until standard install writes the three shims and unsets core.hooksPath", (t) => {
  const cwd = tempRepo(t);
  write(cwd, WIRED);
  git(cwd, "add", "-A");
  const hooks = () => scoreJson(cwd, []).repos[0].cells.find((cell) => cell.row === "hooks");
  assert.deepEqual(hooks().notes, [
    "commit-msg, pre-commit, pre-push are not the standard's hooks. Run pnpm install, so prepare runs standard install and writes them.",
  ]);

  standard(cwd, ["install"]);
  writeFileSync(join(cwd, ".git/hooks/pre-push"), "#!/bin/sh\nexit 0\n");
  git(cwd, "config", "core.hooksPath", ".husky");
  assert.deepEqual(hooks().notes, [
    "pre-push is not the standard's hook. Run pnpm install, so prepare runs standard install and writes them.",
    "core.hooksPath is .husky, so git skips the standard's hooks. Run standard install, which unsets it.",
  ]);

  standard(cwd, ["install"]);
  assert.deepEqual(hooks(), { group: "wiring", row: "hooks", status: "ok", pass: true, notes: [] });
});

test("installed fails when package.json pins a version other than the one that runs", (t) => {
  const pinned = { ...WIRED, "package.json": { scripts: { prepare: "standard install" }, devDependencies: { "@mapringg/standard": "9.9.9" } } };
  const cwd = repoWith(t, pinned);
  const fix = "Run pnpm install, so the installed 0.5.0 becomes the @mapringg/standard 9.9.9 that package.json pins.";
  assert.equal(standard(cwd, ["check", "wiring"]).stdout, `wiring: installed: ${fix}\n`);
  const { status, repos } = scoreJson(cwd, []);
  assert.deepEqual(repos[0].cells.find((cell) => cell.row === "installed").notes, [fix]);
  assert.equal(status, 1);
});

test("a check the pinned version predates is absent, and so is every check without the package", (t) => {
  const old = { ...WIRED, "package.json": { scripts: { prepare: "standard install" }, devDependencies: { "@mapringg/standard": "0.3.0" } } };
  const pinned = scoreJson(repoWith(t, old), []).repos[0];
  assert.deepEqual(pinned.cells.find((cell) => cell.row === "wiring").notes, ["Added in 0.4.0; the repo pins 0.3.0."]);
  assert.equal(statuses(pinned)["pr-size"], "on");

  const bare = scoreJson(repoWith(t, { "README.md": "nothing installed" }), []).repos[0];
  assert.deepEqual(statuses(bare), {
    retired: "ok",
    ci: "fail",
    pin: "fail",
    installed: "ok",
    prepare: "fail",
    "config-file": "fail",
    "claude-md": "ok",
    hooks: "ok",
    config: "ok",
    "commit-subject": "absent",
    "pr-title": "absent",
    "pr-body": "absent",
    "pr-screenshot": "n/a",
    "pr-size": "absent",
    "baseline-growth": "absent",
    wiring: "absent",
  });
  assert.deepEqual([bare.passing, bare.total], [5, 15]);
});

test("a baseline file does not make wiring debt, since wiring keeps no baseline", (t) => {
  const { repos } = scoreJson(repoWith(t, { ...WIRED, ".standard/baselines/wiring.json": { wiring: ["ci"] } }), []);
  assert.equal(statuses(repos[0]).wiring, "on");
});

test("several paths print a matrix with a column and a count per repo", (t) => {
  const wired = repoWith(t, WIRED);
  const bare = repoWith(t, { ...WIRED, "CLAUDE.md": "@AGENTS.md" });
  const [a, b] = [basename(wired), basename(bare)];
  const { stdout, status } = standard(wired, ["score", wired, bare]);
  const lines = stdout.trimEnd().split("\n");
  assert.match(lines[0], new RegExp(`^ +${a}  ${b}$`));
  assert.match(stdout, /^ {2}claude-md {8}ok {2,}fail$/m);
  assert.match(stdout, new RegExp(`^claude-md in ${b}: Make CLAUDE.md exactly "@AGENTS.md" and a newline`, "m"));
  assert.doesNotMatch(stdout, new RegExp(`claude-md in ${a}`));
  assert.deepEqual(lines.slice(-2), [`${a}: 15 of 15 pass`, `${b}: 14 of 15 pass`]);
  assert.equal(status, 1);
});

test("a note that holds for several repos prints once and names them", (t) => {
  const [a, b] = [repoWith(t, { "README.md": "a" }), repoWith(t, { "README.md": "b" })];
  const { stdout } = standard(a, ["score", a, b]);
  const names = `${basename(a)}, ${basename(b)}`;
  assert.match(stdout, new RegExp(`^pr-size in ${names}: The repo does not install @mapringg/standard\\.$`, "m"));
  assert.match(stdout, new RegExp(`^pr-screenshot in ${names}: n/a, \\.standard/config\\.json sets no pr\\.screenshots$`, "m"));
  assert.equal(stdout.match(/^pr-size in /gm).length, 1);
});

test("several paths in JSON give one entry per repo, by folder name", (t) => {
  const wired = repoWith(t, WIRED);
  const other = repoWith(t, WIRED);
  const { status, repos } = scoreJson(tempDir(t, "elsewhere"), [wired, other]);
  assert.deepEqual(repos.map((repo) => repo.name), [basename(wired), basename(other)]);
  assert.deepEqual(repos.map((repo) => [repo.passing, repo.total]), [[15, 15], [15, 15]]);
  assert.equal(status, 0);
});

test("--remote reads each repo's GitHub settings once through gh and scores them", (t) => {
  const gh = fakeGh(t, { ...GOOD_SETTINGS, allow_merge_commit: true, squash_merge_commit_message: "COMMIT_MESSAGES" });
  const [a, b] = [repoWith(t, WIRED), repoWith(t, WIRED)];
  const { status, repos } = scoreJson(a, ["--remote", a, b], gh.env);
  assert.deepEqual(gh.calls(), [
    { cwd: a, args: ["api", "--paginate", "repos/mapringg/standard/tags", "--jq", ".[].name"] },
    { cwd: a, args: ["api", "repos/{owner}/{repo}"] },
    { cwd: b, args: ["api", "repos/{owner}/{repo}"] },
  ]);
  const github = repos[0].cells.filter((cell) => cell.group === "github");
  assert.deepEqual(github, [
    { group: "github", row: "default-branch", status: "ok", pass: true, notes: [] },
    { group: "github", row: "squash-only", status: "fail", pass: false, notes: ["Set allow_merge_commit to false; it is true."] },
    { group: "github", row: "pr-title", status: "ok", pass: true, notes: [] },
    { group: "github", row: "blank-message", status: "fail", pass: false, notes: ['Set squash_merge_commit_message to "BLANK"; it is "COMMIT_MESSAGES".'] },
    { group: "github", row: "delete-branch", status: "ok", pass: true, notes: [] },
    { group: "github", row: "current", status: "ok", pass: true, notes: [] },
  ]);
  assert.deepEqual([repos[0].passing, repos[0].total], [19, 21]);
  assert.equal(status, 1);
});

test("--remote passes a repo whose settings all match", (t) => {
  const gh = fakeGh(t, GOOD_SETTINGS);
  const { status, repos } = scoreJson(repoWith(t, WIRED), ["--remote"], gh.env);
  assert.deepEqual([repos[0].passing, repos[0].total], [21, 21]);
  assert.equal(status, 0);
});

test("--remote fails current when a newer release tag than the pin exists", (t) => {
  const gh = fakeGh(t, GOOD_SETTINGS, ["v0.4.0", "v0.10.0", "v0.9.1", "v1.0.0-rc.1"]);
  const { status, repos } = scoreJson(repoWith(t, WIRED), ["--remote"], gh.env);
  assert.deepEqual(repos[0].cells.at(-1), {
    group: "github",
    row: "current",
    status: "fail",
    pass: false,
    notes: ["Bump @mapringg/standard to v0.10.0, the latest release; the repo pins 0.5.0."],
  });
  assert.equal(status, 1);
});

test("without --remote, score never calls gh", (t) => {
  const gh = fakeGh(t, GOOD_SETTINGS);
  const { repos } = scoreJson(repoWith(t, WIRED), [], gh.env);
  assert.deepEqual(gh.calls(), []);
  assert.equal(repos[0].cells.some((cell) => cell.group === "github"), false);
});

test("score refuses an unknown option", (t) => {
  const { stderr, status } = standard(repoWith(t, WIRED), ["score", "--remot"]);
  assert.match(stderr, /^standard: Unknown option '--remot'/);
  assert.equal(status, 1);
});
