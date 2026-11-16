import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CLI = join(import.meta.dirname, "../bin/standard.mjs");

const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^(GIT_|GITHUB_)/.test(name)),
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
  if (config) writeFileSync(join(cwd, "standard.json"), JSON.stringify(config));
  return cwd;
}

export function commit(cwd, message) {
  git(cwd, "commit", "-q", "--allow-empty", "--no-verify", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

export function linkPackage(root) {
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  symlinkSync(CLI, join(root, "node_modules/.bin/standard"));
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
