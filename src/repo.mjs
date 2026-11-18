import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { defaults } from "./defaults.mjs";

import { loadConfig } from "./config.mjs";

/**
 * @typedef {object} Repo
 * @property {string} root Absolute path of this worktree.
 * @property {string} name Folder name of the main checkout. Every worktree of one repo has the same name.
 * @property {import("./config.mjs").Config} config
 * @property {(glob?: string) => string[]} files Tracked paths, posix, relative to root.
 * @property {(path: string) => string} read
 * @property {(commit: string, path: string) => string | null} readAt
 */

/**
 * @param {string} cwd
 * @param {...string} args
 * @returns {string}
 */
export function git(cwd, ...args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
  } catch (error) {
    const { stderr = "" } = /** @type {{ stderr?: string }} */ (error);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}. ${stderr.trim()}`);
  }
}

/**
 * @param {string} cwd
 * @returns {string} The .git folder that all worktrees of this repo share.
 */
export function commonDir(cwd) {
  return git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
}

/**
 * @param {string} cwd
 * @returns {Repo}
 */
export function loadRepo(cwd) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  /** @type {Repo["files"]} */
  const files = (glob) =>
    git(root, "ls-files", "-z", ...(glob ? ["--", `:(glob)${glob}`] : []))
      .split("\0")
      .filter(Boolean);
  /** @type {Repo} */
  const repo = {
    root,
    name: basename(dirname(commonDir(root))),
    config: loadConfig(root, (path) => files(path).includes(path)),
    files,
    read: (path) => readFileSync(join(root, path), "utf8"),
    readAt(commit, path) {
      const object = `${commit}:${path}`;
      const exists = spawnSync("git", ["cat-file", "-e", object], { cwd: root }).status === 0;
      return exists ? git(root, "show", object) : null;
    },
  };
  return { ...repo, config: defaults(repo) };
}

/**
 * @param {Repo} repo
 * @param {string} path
 * @returns {string | null}
 */
export function tracked(repo, path) {
  return repo.files(path).includes(path) ? repo.read(path) : null;
}
