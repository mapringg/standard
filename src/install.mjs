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
 * @param {string} content
 * @returns {boolean}
 */
function writeIfDifferent(path, content) {
  const current =
    existsSync(path) && statSync(path).mode & 0o111 ? readFileSync(path, "utf8") : null;
  if (current === content) return false;
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

  const configured = () =>
    spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: root, encoding: "utf8" });
  if (configured().status === 0) {
    spawnSync("git", ["config", "--local", "--unset-all", "core.hooksPath"], { cwd: root });
    const left = configured();
    if (left.status === 0) {
      throw new Error(
        `core.hooksPath is still ${left.stdout.trim()} outside this repo's config, so git skips the hooks in ${hooks}. Unset it: ${git(root, "config", "--show-origin", "--get", "core.hooksPath")}`,
      );
    }
    changes.push("unset core.hooksPath");
  }
  return changes;
}
