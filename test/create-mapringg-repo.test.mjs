import { deepEqual, equal, match } from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { githubRepo } from "../create-mapringg-repo/github.mjs";
import { configure } from "../create-mapringg-repo/setup.mjs";

const cli = join(import.meta.dirname, "../create-mapringg-repo/cli.mjs");
const mock = `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
const store = process.env.CREATOR_TEST_STORE;
const log = join(store, "calls");
const add = (message) => writeFileSync(log, message + "\\n", { flag: "a" });
const localRepo = (name) => join(store, name + ".git");
const output = (value) => console.log(JSON.stringify(value));
const missing = () => { console.error("gh: Not Found (HTTP 404)"); process.exit(1); };
if (args[0] === "api") {
  const [, , method, path] = args;
  if (args[1] === "user") console.log("owner");
  else if (path.includes("/check-runs?")) output({check_runs: [{status: "completed", conclusion: "success"}]});
  else if (path.includes("/protection")) {
    if (method === "GET") missing();
    add("protected"); output({});
  } else {
    const name = path.split("/")[2];
    if (!existsSync(localRepo(name))) missing();
    if (method === "PATCH") add("settings");
    output({name, visibility: "private", permissions: {admin: true}, default_branch: "main",
      html_url: "https://github.com/owner/" + name, clone_url: "https://github.com/owner/" + name + ".git",
      allow_merge_commit: false, allow_rebase_merge: false, allow_squash_merge: true,
      squash_merge_commit_title: "PR_TITLE", squash_merge_commit_message: "BLANK"});
  }
} else if (args[0] === "repo" && args[1] === "create") {
  const name = args[2].split("/").at(-1);
  execFileSync("git", ["init", "--bare", "-b", "main", localRepo(name)]);
  execFileSync("git", ["remote", "add", "origin", "https://github.com/owner/" + name + ".git"]);
  add("created");
} else if (args[0] === "repo" && args[1] === "clone") {
  execFileSync("git", ["clone", localRepo("template"), args[3]]);
} else if (args[0] === "pr") {
  const prFile = join(store, "pr");
  if (args[1] === "list") output(existsSync(prFile) ? [JSON.parse(readFileSync(prFile))] : []);
  else {
    const fail = join(store, "fail-once");
    if (existsSync(fail)) {
      require("node:fs").unlinkSync(fail);
      console.error("simulated disconnect");
      process.exit(1);
    }
    const branch = args[args.indexOf("--head") + 1];
    const headRefOid = execFileSync("git", ["ls-remote", "origin", "refs/heads/" + branch], {encoding: "utf8"}).split("\t")[0];
    const url = "https://github.com/owner/existing/pull/1";
    writeFileSync(prFile, JSON.stringify({number: 1, url, headRefName: branch, headRefOid}));
    writeFileSync(join(store, "body"), readFileSync(0));
    add("pr");
    console.log(url);
  }
} else process.exit(99);
`;

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "standard-creator-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote");
  const bin = join(root, "bin");
  mkdirSync(remote);
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), mock, { mode: 0o755 });
  writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CREATOR_TEST_STORE: remote,
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "Setup Test",
    GIT_CONFIG_KEY_1: "user.email",
    GIT_CONFIG_VALUE_1: "test@example.com",
    GIT_CONFIG_KEY_2: `url.file://${remote}/.insteadOf`,
    GIT_CONFIG_VALUE_2: "https://github.com/owner/",
    GIT_CONFIG_KEY_3: "commit.gpgsign",
    GIT_CONFIG_VALUE_3: "false",
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();
  return {
    root,
    remote,
    git,
    run: (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" }),
  };
}

function setupRepo(s, name) {
  const work = join(s.root, name);
  mkdirSync(work);
  s.git(work, "init", "-b", "main");
  s.git(s.root, "init", "--bare", "-b", "main", join(s.remote, `${name}.git`));
  s.git(work, "remote", "add", "origin", `https://github.com/owner/${name}.git`);
  return work;
}

function commit(s, work) {
  s.git(work, "add", "--all");
  s.git(work, "commit", "-m", "Existing files");
  s.git(work, "push", "origin", "main");
}

test("creates a plain private repository with one root and safely reruns", (t) => {
  const s = sandbox(t);
  const first = s.run(s.root, "--name", "plain-demo", "--type", "plain");
  equal(first.status, 0, first.stderr);
  match(first.stdout, /Check passed/);
  const local = join(s.root, "plain-demo");
  equal(s.git(local, "log", "--format=%s"), "Initial commit");
  match(readFileSync(join(local, "AGENTS.md"), "utf8"), /capture\/SKILL\.md/);
  const second = s.run(s.root, "--name", "plain-demo", "--type", "plain");
  equal(second.status, 0, second.stderr);
  match(second.stdout, /Already aligned/);
  equal(readFileSync(join(s.remote, "calls"), "utf8").match(/created/g)?.length, 1);
});

test("creates an app from the template and resumes with no duplicate history", (t) => {
  const s = sandbox(t);
  const template = setupRepo(s, "template");
  writeFileSync(
    join(template, "package.json"),
    '{"name":"monorepo","scripts":{"lint":"oxlint","test":"node --test"}}\n',
  );
  writeFileSync(join(template, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(join(template, ".github", "workflows"), { recursive: true });
  writeFileSync(join(template, ".github", "workflows", "deploy-production.yml"), "on: push\njobs: {}\n");
  commit(s, template);
  const created = s.run(s.root, "--name", "app-demo", "--type", "app");
  equal(created.status, 0, created.stderr);
  const local = join(s.root, "app-demo");
  equal(s.git(local, "log", "--format=%s"), "Initial commit");
  match(readFileSync(join(local, "package.json"), "utf8"), /"name":\s*"app-demo"/);
  match(readFileSync(join(local, ".github", "workflows", "deploy-production.yml"), "utf8"), /on: workflow_dispatch/);
});

test("adopts an existing branch, recovers after the push, and reuses its PR", (t) => {
  const s = sandbox(t);
  const local = setupRepo(s, "existing");
  writeFileSync(join(local, "README.md"), "# Existing\n");
  commit(s, local);
  writeFileSync(join(local, "local.txt"), "Keep my work\n");
  writeFileSync(join(s.remote, "fail-once"), "");
  const first = s.run(local, "--type", "plain");
  equal(first.status, 1);
  match(first.stderr, /simulated disconnect/);
  const second = s.run(local, "--type", "plain");
  equal(second.status, 0, second.stderr);
  match(second.stdout, /Setup PR:.*\/pull\/1/);
  const third = s.run(local, "--type", "plain");
  equal(third.status, 0, third.stderr);
  match(third.stdout, /Setup PR:.*\/pull\/1/);
  equal(readFileSync(join(s.remote, "calls"), "utf8").match(/^pr$/gm)?.length, 1);
  equal(s.git(local, "log", "--format=%s"), "Existing files");
  equal(readFileSync(join(local, "local.txt"), "utf8"), "Keep my work\n");
  const body = readFileSync(join(s.remote, "body"), "utf8");
  match(body, /\*\*Before:\*\*.+\n- \*\*After:\*\*.+/);
});

test("updates an app checker while preserving other workflows and is idempotent", (t) => {
  const { root } = sandbox(t);
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, ".oxlintrc.json"), '{"extends":["./node_modules/@mapringg/standard/oxlint.json"]}\n');
  writeFileSync(
    join(root, "package.json"),
    '{"devDependencies":{"@mapringg/standard":"github:mapringg/standard#v1.10.0"}}\n',
  );
  writeFileSync(join(root, "AGENTS.md"), "# App\n\n## Sources\n\n- [Product guide](PRODUCT.md)\n");
  const path = join(dir, "ci.yml");
  writeFileSync(
    path,
    "on:\n  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\njobs:\n  check:\n    name: Check\n    steps:\n      - run: pnpm lint\n",
  );
  const unrelated = join(dir, "deploy.yml");
  writeFileSync(unrelated, "on: workflow_dispatch\n");
  deepEqual(configure(root, "app"), { check: "Check", updateLock: true });
  const once = readFileSync(path, "utf8");
  match(once, /edited/);
  match(once, /branches: \[ main \]/);
  const doc = readFileSync(join(root, "AGENTS.md"), "utf8");
  match(doc, /node_modules\/@mapringg\/standard.*capture\/SKILL\.md/);
  match(doc, /Product guide/);
  deepEqual(configure(root, "app"), { check: "Check", updateLock: false });
  equal(readFileSync(path, "utf8"), once);
  equal(readFileSync(join(root, "AGENTS.md"), "utf8"), doc);
  equal(readFileSync(unrelated, "utf8"), "on: workflow_dispatch\n");
  equal(existsSync(join(dir, "standard-pr.yml")), false);
  equal(githubRepo("git@github.com:some-owner/my-app.git"), "some-owner/my-app");
});
