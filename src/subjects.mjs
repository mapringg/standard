import { readFileSync } from "node:fs";

import { git } from "./repo.mjs";

/**
 * Where a commit sits decides which rules can still be fixed there.
 * "message" is a message about to be committed, "branch" is a commit that a squash will replace,
 * and "trunk" is a commit pushed to develop or main.
 * @typedef {"message" | "branch" | "trunk"} CommitSource
 *
 * @typedef {object} Commit
 * @property {string | null} sha Null for a message that is not committed yet.
 * @property {string} subject
 * @property {string} body Everything after the subject line, trailers included.
 * @property {number | null} parents Null for a message that is not committed yet.
 * @property {CommitSource} source
 */

const SCISSORS = /^# -+ >8 -+$/m;
const RECORD_END = "\x1e";
const FIELD_END = "\x1f";
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
/** The id git and GitHub send for the missing side of a created or deleted ref. */
export const NO_COMMIT = /^0+$/;
export const TRUNKS = ["refs/heads/develop", "refs/heads/main"];

/**
 * @param {string | null} sha
 * @param {string} message
 * @param {number | null} parents
 * @param {CommitSource} source
 * @returns {Commit}
 */
function commit(sha, message, parents, source) {
  const [subject = "", ...body] = message.trim().split("\n");
  return { sha, subject: subject.trim(), body: body.join("\n"), parents, source };
}

/**
 * @param {string} path The file git passes to the commit-msg hook.
 * @returns {Commit}
 */
export function commitFromFile(path) {
  const message = readFileSync(path, "utf8")
    .split(SCISSORS)[0]
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  return commit(null, message, null, "message");
}

/**
 * @param {string} root
 * @param {string} range
 * @param {CommitSource} source
 * @returns {Commit[]}
 */
export function commitsInRange(root, range, source) {
  return git(root, "log", `--format=%H${FIELD_END}%P${FIELD_END}%B${RECORD_END}`, range)
    .split(RECORD_END)
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, parents, message] = record.trimStart().split(FIELD_END);
      return commit(sha, message, parents.split(" ").filter(Boolean).length, source);
    });
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function sha(value, field) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new Error(`The GitHub event has no commit id at ${field}.`);
  }
  return value;
}

/**
 * @param {string} root
 * @param {string} path GITHUB_EVENT_PATH.
 * @returns {Commit[] | null} Null when the event carries no commits to check.
 */
export function commitsFromEvent(root, path) {
  const event = JSON.parse(readFileSync(path, "utf8"));
  if (event.pull_request) {
    const base = sha(event.pull_request.base?.sha, "pull_request.base.sha");
    const head = sha(event.pull_request.head?.sha, "pull_request.head.sha");
    return commitsInRange(root, `${base}..${head}`, "branch");
  }
  const isBranchPush = typeof event.ref === "string" && event.ref.startsWith("refs/heads/");
  if (!isBranchPush || typeof event.after !== "string") return null;
  // A created or deleted branch has no earlier tip to compare with. Its pull request checks its commits.
  if (NO_COMMIT.test(event.before) || NO_COMMIT.test(event.after)) return null;
  const range = `${sha(event.before, "before")}..${sha(event.after, "after")}`;
  return commitsInRange(root, range, TRUNKS.includes(event.ref) ? "trunk" : "branch");
}
