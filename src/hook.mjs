import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { registry } from "./registry.mjs";
import { git } from "./repo.mjs";
import { failed, run } from "./run.mjs";
import { NO_COMMIT, TRUNKS, commitFromFile } from "./subjects.mjs";

/**
 * @typedef {import("./repo.mjs").Repo} Repo
 * @typedef {number} ExitCode
 * @typedef {(repo: Repo, args: string[]) => ExitCode | Promise<ExitCode>} Hook
 */

/**
 * @param {Repo} repo
 * @param {"pre-commit" | "pre-push"} hook
 * @returns {ExitCode}
 */
function runLines(repo, hook) {
  for (const line of repo.config.hooks[hook]) {
    const { status } = spawnSync("sh", ["-c", line], {
      cwd: repo.root,
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (status !== 0) {
      console.error(`${hook}: "${line}" failed, so the later lines did not run.`);
      return 1;
    }
  }
  return 0;
}

/**
 * @param {Repo} repo
 * @returns {boolean}
 */
function pushesMergeCommit(repo) {
  for (const line of readFileSync(0, "utf8").split("\n").filter(Boolean)) {
    const [, localSha, remoteRef] = line.split(" ");
    if (TRUNKS.includes(remoteRef) || NO_COMMIT.test(localSha)) continue;
    const merges = git(repo.root, "rev-list", "--merges", `origin/develop..${localSha}`);
    if (!merges) continue;
    console.error(
      `pre-push: ${remoteRef} has merge commits that origin/develop lacks. Drop them: rebase onto the pull request's base branch and push with --force-with-lease.`,
    );
    console.error(git(repo.root, "log", "--oneline", "--no-walk", ...merges.split("\n")));
    return true;
  }
  return false;
}

/** @type {Record<string, Hook>} */
export const HOOKS = {
  async "commit-msg"(repo, [file]) {
    if (!file) throw new Error("hook commit-msg needs the path of the commit message file.");
    const results = await run({
      checks: registry.filter((check) => check.subject === "commit"),
      repo,
      scope: { commits: [commitFromFile(file)] },
    });
    for (const result of results) {
      if (result.outcome !== "ran") continue;
      for (const { fix } of result.findings) console.error(`commit-msg: ${fix}`);
    }
    return failed(results) ? 1 : 0;
  },
  "pre-commit": (repo) => runLines(repo, "pre-commit"),
  "pre-push": (repo) => (pushesMergeCommit(repo) ? 1 : runLines(repo, "pre-push")),
};
