import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { HOOKS } from "./hook.mjs";
import { commonDir, git } from "./repo.mjs";

/**
 * @param {string} hook
 */
function shim(hook) {
  return `#!/bin/sh\nexec "$(git rev-parse --show-toplevel)/node_modules/.bin/standard" hook ${hook} "$@"\n`;
}

/**
 * @param {string} path
 * @returns {string | null} The hook's text, or null when git would not run it.
 */
function executable(path) {
  return existsSync(path) && statSync(path).mode & 0o111 ? readFileSync(path, "utf8") : null;
}

/**
 * @param {string} root
 */
function hooksPath(root) {
  return spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
}

/**
 * @param {string} path
 * @param {string} content
 * @returns {boolean}
 */
function writeIfDifferent(path, content) {
  if (executable(path) === content) return false;
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  chmodSync(temporary, 0o755);
  renameSync(temporary, path);
  return true;
}

/**
 * @param {string} root
 * @returns {string[]} One line per thing this run changed.
 */
export function install(root) {
  const hooks = join(commonDir(root), "hooks");
  mkdirSync(hooks, { recursive: true });
  const changes = Object.keys(HOOKS)
    .filter((hook) => writeIfDifferent(join(hooks, hook), shim(hook)))
    .map((hook) => `wrote ${join(hooks, hook)}`);

  if (hooksPath(root).status === 0) {
    spawnSync("git", ["config", "--local", "--unset-all", "core.hooksPath"], { cwd: root });
    const left = hooksPath(root);
    if (left.status === 0) {
      throw new Error(
        `core.hooksPath is still ${left.stdout.trim()} outside this repo's config, so git skips the hooks in ${hooks}. Unset it: ${git(root, "config", "--show-origin", "--get", "core.hooksPath")}`,
      );
    }
    changes.push("unset core.hooksPath");
  }
  return changes;
}

/**
 * @param {string} root
 * @returns {string[]} What keeps git from running the standard's hooks, empty when nothing does.
 */
export function hookProblems(root) {
  const hooks = join(commonDir(root), "hooks");
  const missing = Object.keys(HOOKS).filter((hook) => executable(join(hooks, hook)) !== shim(hook));
  const configured = hooksPath(root);
  return [
    ...(missing.length > 0
      ? [`${missing.join(", ")} ${missing.length === 1 ? "is not the standard's hook" : "are not the standard's hooks"}. Run pnpm install, so prepare runs standard install and writes them.`]
      : []),
    ...(configured.status === 0
      ? [`core.hooksPath is ${configured.stdout.trim()}, so git skips the standard's hooks. Run standard install, which unsets it.`]
      : []),
  ];
}
