import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const CLI = join(import.meta.dirname, "../bin/standard.mjs");

const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^(GIT_|GITHUB_|GH_)/.test(name)),
);

export const ENV = {
  ...inherited,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: ENV }).trim();
}

export function tryGit(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: ENV });
}

export function standard(cwd, args, { env = {}, input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...ENV, ...env },
    input,
    encoding: "utf8",
  });
}

export function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), `standard-${prefix}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function tempRepo(t, config) {
  const cwd = tempDir(t, "repo");
  git(cwd, "init", "-q", "-b", "develop");
  if (config) write(cwd, { ".standard/config.json": config });
  return cwd;
}

export function commit(cwd, message) {
  git(cwd, "commit", "-q", "--allow-empty", "--no-verify", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

export function linkPackage(root) {
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  symlinkSync(CLI, join(root, "node_modules/.bin/standard"));
  installPackage(root);
}

export function installPackage(root) {
  mkdirSync(join(root, "node_modules/@mapringg"), { recursive: true });
  symlinkSync(join(import.meta.dirname, ".."), join(root, "node_modules/@mapringg/standard"));
}

export function eventFile(t, event) {
  const path = join(tempDir(t, "event"), "event.json");
  writeFileSync(path, JSON.stringify(event));
  return path;
}

export function checkEvent(t, cwd, event, args = []) {
  return standard(cwd, ["check", ...args], {
    env: { GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: eventFile(t, event) },
  });
}

export const GOOD_BODY = [
  "## Summary",
  "",
  "Check pull request titles and bodies from the standard package.",
  "",
  "## Evidence",
  "",
  "**Before:** 3 fail.",
  "",
  "**After:** 0 fail.",
  "",
  "## Merge Danger",
  "",
  "**Door:** two-way",
  "",
  "**Blast Radius:** annotations",
].join("\n");

export function pullRequestEvent({ base, head, number = 123, title = "Add the pull request checks", body = GOOD_BODY, author = "someone" }) {
  return {
    pull_request: {
      number,
      title,
      body,
      user: { login: author },
      base: { ref: "develop", sha: base },
      head: { ref: "feature", sha: head },
      additions: 1,
      deletions: 0,
    },
  };
}

export const WIRED = {
  ".standard/config.json": { hooks: { "pre-push": ["pnpm test"] } },
  "package.json": {
    scripts: { prepare: "standard install", test: "node --test" },
    devDependencies: { "@mapringg/standard": "github:mapringg/standard#v0.15.0" },
  },
  ".github/workflows/ci.yml": [
    "on:",
    "  pull_request:",
    "jobs:",
    "  check:",
    "    name: Check",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "        with:",
    "          fetch-depth: 0",
    "      - run: pnpm install",
    "      - run: pnpm exec standard check",
    "      - run: pnpm test",
    "",
  ].join("\n"),
};

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path);
    if (content === null) {
      rmSync(full);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
}

export function pullRequestRepo(t, { base = {}, head = { "README.md": "changed" } } = {}) {
  const cwd = tempRepo(t);
  write(cwd, base);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--allow-empty", "--no-verify", "-m", "Start the repository");
  const baseSha = git(cwd, "rev-parse", "HEAD");
  git(cwd, "switch", "-q", "-c", "feature");
  write(cwd, head);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--no-verify", "-m", "Change the sample files");
  installPackage(cwd);
  return { cwd, base: baseSha, head: git(cwd, "rev-parse", "HEAD") };
}
