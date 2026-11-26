#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { command, github, githubRepo } from "./github.mjs";
import { configure } from "./setup.mjs";

const TEMPLATE = "mapringg/monorepo";
const SETUP_BRANCH = "mapring/setup-standard-";
const SETUP_TITLE = "Set up the shared repository standard";
const LOCAL_STATE = "mapring.creator";
const REPO_NAME = /^(?!\.{1,2}$)[a-z\d][a-z\d._-]{0,99}$/i;

const { values: flags } = parseArgs({
  options: {
    type: { type: "string" },
    name: { type: "string" },
    new: { type: "boolean" },
    public: { type: "boolean" },
    private: { type: "boolean" },
    "no-wait": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const git = (cwd, args, options) => command(cwd, "git", args, options);
const gh = (cwd, args, options) => command(cwd, "gh", args, options);
const print = console.log;

async function ask(question, fallback) {
  if (!stdin.isTTY) {
    if (fallback) return fallback;
    throw new Error(`Supply ${question} as a command-line option (see --help).`);
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return (await prompt.question(`${question}${fallback ? ` [${fallback}]` : ""} `)).trim() || fallback;
  } finally {
    prompt.close();
  }
}

function stateAt(root) {
  const state = git(root, ["config", "--local", "--get", LOCAL_STATE], { allowFailure: true });
  return state.ok ? JSON.parse(state.output) : null;
}

function saveState(root, state) {
  git(root, ["config", "--local", LOCAL_STATE, JSON.stringify(state)]);
}

function hasCommit(root) {
  return git(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).ok;
}

function copyTemplate(root, scratch) {
  const template = join(scratch, "template");
  gh(root, ["repo", "clone", TEMPLATE, template, "--", "--depth=1", "--no-tags"], { stream: true });
  const paths = git(template, ["ls-files", "-z"]).output.split("\0").filter(Boolean);
  for (const path of paths) {
    const to = join(root, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(template, path), to, { dereference: false, verbatimSymlinks: true });
  }
}

function checks(root, kind, updateLock, initial) {
  const path = join(root, "package.json");
  if ((kind !== "app" && !updateLock) || !existsSync(path)) return;
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const runner = existsSync(join(root, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(root, "package-lock.json"))
      ? "npm"
      : null;
  if (!runner) {
    if (updateLock) throw new Error("Refresh this repository’s dependency lockfile before adopting Standard.");
    return;
  }
  if (updateLock) {
    const args =
      runner === "pnpm" ? ["install", "--lockfile-only", "--no-frozen-lockfile"] : ["install", "--package-lock-only"];
    command(root, runner, args, { stream: true });
  }
  command(root, runner, runner === "pnpm" ? ["install", "--frozen-lockfile"] : ["ci"], { stream: true });
  const scripts = ["lint", "format:check", "knip", ...(initial ? ["test"] : [])];
  for (const script of scripts) {
    if (manifest.scripts?.[script]) command(root, runner, ["run", script], { stream: true });
  }
}

function configureProtection(host, base, check) {
  if (host.requireCheck(base, check)) {
    print(`GitHub requires ${check} on ${base}.`);
  } else {
    print(`GitHub Free cannot require ${check} on this private repo. Wait for a green check before merging.`);
  }
}

function push(root, scratch, refs) {
  const hooks = join(scratch, "empty-hooks");
  mkdirSync(hooks, { recursive: true });
  git(root, ["-c", `core.hooksPath=${hooks}`, "push", "-u", "origin", ...refs], { stream: true });
}

async function create(root, state, scratch) {
  const host = github(root, state.repo);
  let remote = host.lookup();
  if (!hasCommit(root)) {
    if (remote) throw new Error(`GitHub already has ${state.repo}. Use an existing checkout to adopt it.`);
    if (!state.scaffolded) {
      if (state.kind === "app") copyTemplate(root, scratch);
      if (!existsSync(join(root, "README.md"))) writeFileSync(join(root, "README.md"), `# ${basename(root)}\n`);
      saveState(root, { ...state, scaffolded: true });
    }
    const { check, updateLock } = configure(root, basename(root), { kind: state.kind, initial: true });
    checks(root, state.kind, updateLock, true);
    git(root, ["add", "--all"]);
    git(root, ["commit", "-m", "Initial commit"], { stream: true });
    state.check = check;
    saveState(root, state);
  }
  const sha = git(root, ["rev-parse", "refs/heads/main"]).output;
  if (!state.check) {
    state.check = configure(root, basename(root), { kind: state.kind, initial: true }).check;
    saveState(root, state);
  }
  if (!remote) {
    gh(
      root,
      ["repo", "create", state.repo, state.visibility === "public" ? "--public" : "--private", "--source", root],
      { stream: true },
    );
    remote = host.lookup();
  }
  if (!remote?.permissions?.admin) throw new Error(`Admin access is required for ${state.repo}.`);
  if (remote.visibility !== state.visibility)
    throw new Error(`Visibility differs for ${state.repo}. Review the existing GitHub repo.`);
  if (!git(root, ["config", "--get", "remote.origin.url"], { allowFailure: true }).ok) {
    git(root, ["remote", "add", "origin", remote.clone_url]);
  }
  if (
    githubRepo(git(root, ["config", "--get", "remote.origin.url"]).output).toLowerCase() !== state.repo.toLowerCase()
  ) {
    throw new Error("The local origin points to a different repository.");
  }
  const refs = git(root, ["ls-remote", "--heads", "origin"]).output;
  const current = refs
    .split("\n")
    .find((line) => line.endsWith("\trefs/heads/main"))
    ?.split("\t")[0];
  if (current && current !== sha)
    throw new Error("GitHub main already has different content. Rerun from a checkout of that branch to adopt it.");
  if (!current && refs) throw new Error("GitHub already has another branch. Use an existing checkout to adopt it.");
  host.configureMerge(remote);
  if (!current) push(root, scratch, ["main"]);
  configureProtection(host, "main", state.check);
  if (!flags["no-wait"]) await host.waitForCheck(sha, state.check);
  git(root, ["config", "--local", "--unset", LOCAL_STATE]);
  print(`${remote.html_url}\n${root}`);
}

function existingSource(root) {
  const url = git(root, ["config", "--get", "remote.origin.url"]).output;
  if (!url) throw new Error("Set a GitHub origin before adopting this repository.");
  return { url, repo: githubRepo(url) };
}

function setupBody(check, local) {
  return `## Summary

\`\`\`text
Repository
  PR writing and Capture
  ${check}
  Squash merge
\`\`\`

## Evidence

- **Before:** The repository was missing part of the shared PR workflow.
- **After:** The setup diff aligns the skill links and PR check. ${local}

## Merge Danger

**Door:** two-way

**Blast Radius:** repository
`;
}

async function adopt(root, kind, scratch) {
  const { url, repo } = existingSource(root);
  const host = github(root, repo);
  const remote = host.lookup();
  if (!remote?.permissions?.admin) throw new Error(`Admin access is required for ${repo}.`);
  const base = remote.default_branch;
  const work = join(scratch, "checkout");
  git(root, ["clone", "--single-branch", "--no-tags", "--branch", base, url, work], { stream: true });
  const baseSha = git(work, ["rev-parse", "HEAD"]).output;
  const branch = `${SETUP_BRANCH}${baseSha.slice(0, 12)}`;
  const { check, updateLock } = configure(work, remote.name, { kind });
  const modified = git(work, ["status", "--porcelain"]).output;
  host.configureMerge(remote);
  if (!modified) {
    configureProtection(host, base, check);
    print(`Already aligned.\n${remote.html_url}\n${root}`);
    return;
  }
  const open = host.pulls(base).find((pull) => !pull.isCrossRepository && pull.headRefName.startsWith(SETUP_BRANCH));
  if (open) {
    print(`Setup PR: ${open.url}`);
    if (!flags["no-wait"]) await host.waitForCheck(open.headRefOid, check);
    configureProtection(host, base, check);
    return;
  }
  checks(work, kind, updateLock, false);
  for (const file of [
    "AGENTS.md",
    "mise.toml",
    ".mise.toml",
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    ".github/workflows",
  ]) {
    if (existsSync(join(work, file))) git(work, ["add", "--", file]);
  }
  const tree = git(work, ["write-tree"]).output;
  const known = git(work, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).output;
  let head;
  if (known) {
    git(work, ["fetch", "origin", branch]);
    head = git(work, ["rev-parse", "FETCH_HEAD"]).output;
    const parents = git(work, ["show", "-s", "--format=%P", head]).output;
    if (git(work, ["rev-parse", `${head}^{tree}`]).output !== tree || parents !== baseSha) {
      throw new Error(`The existing setup branch ${branch} has different changes. Review it before rerunning.`);
    }
  } else {
    git(work, ["switch", "-c", branch]);
    git(work, ["commit", "-m", SETUP_TITLE], { stream: true });
    head = git(work, ["rev-parse", "HEAD"]).output;
    push(work, scratch, [branch]);
  }
  const evidence =
    kind === "app"
      ? "Applicable local project checks passed."
      : "The setup diff preserves the repository’s files and checks.";
  const pr = host.createPull(base, branch, SETUP_TITLE, setupBody(check, evidence));
  print(`Setup PR: ${pr}\n${root}`);
  if (!flags["no-wait"]) await host.waitForCheck(head, check);
  configureProtection(host, base, check);
}

async function main() {
  if (flags.help) {
    print(
      "Usage: create-mapringg-repo [--type app|plain] [--new --name NAME] [--public|--private] [--no-wait]\n\nRun in an existing GitHub checkout to adopt it, or outside Git to create a repo.",
    );
    return;
  }
  if (flags.public && flags.private) throw new Error("Choose one visibility.");
  const cwd = resolve(".");
  const located = git(cwd, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  let root = located.ok && !flags.new && !flags.name ? located.output : null;
  let state = root ? stateAt(root) : null;
  if (!root) {
    const name = flags.name ?? (await ask("Repository name"));
    if (!name || !REPO_NAME.test(name))
      throw new Error("Use a GitHub repository name with letters, numbers, periods, underscores, or hyphens.");
    root = join(cwd, name);
    if (existsSync(root) && readdirSync(root).length > 0) {
      const child = git(root, ["rev-parse", "--show-toplevel"], { allowFailure: true });
      if (!child.ok || child.output !== root)
        throw new Error(`${root} already exists and is not an initialized setup folder.`);
      state = stateAt(root);
    } else {
      const kind = flags.type ?? (await ask("App or plain?", "plain"));
      if (!["app", "plain"].includes(kind)) throw new Error("Choose app or plain.");
      const visibility = flags.public
        ? "public"
        : flags.private
          ? "private"
          : await ask("Private or public?", "private");
      if (!["private", "public"].includes(visibility)) throw new Error("Choose private or public.");
      const owner = gh(cwd, ["api", "user", "--jq", ".login"]).output;
      mkdirSync(root, { recursive: true });
      git(root, ["init", "-b", "main"], { stream: true });
      state = { repo: `${owner}/${name}`, kind, visibility };
      saveState(root, state);
    }
  }
  const kind =
    state?.kind ?? flags.type ?? (await ask("App or plain?", existsSync(join(root, "package.json")) ? "app" : "plain"));
  if (!["app", "plain"].includes(kind)) throw new Error("Choose app or plain.");
  const scratch = mkdtempSync(join(tmpdir(), "create-mapringg-repo-"));
  try {
    if (state) await create(root, state, scratch);
    else await adopt(root, kind, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
