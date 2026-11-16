import { execFileSync } from "node:child_process";
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
 *
 * @typedef {object} PullRequest
 * @property {number} number
 * @property {string} title
 * @property {string} body
 * @property {string} author Login as the pull_request event names it, such as "dependabot[bot]".
 * @property {string} base
 * @property {string} baseSha
 * @property {string} headSha
 * @property {Commit[]} commits
 * @property {string[]} changedFiles
 * @property {LineChange[]} lineChanges One per changed file. A binary file counts zero lines.
 * @property {number} additions
 * @property {number} deletions
 *
 * @typedef {{ path: string, additions: number, deletions: number }} LineChange
 *
 * @typedef {{ commits: Commit[] | null, pr: PullRequest | null }} Subjects
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
 * @param {string} source
 * @returns {string}
 */
function sha(value, field, source) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new Error(`${source} has no commit id at ${field}.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {string} source
 * @returns {string}
 */
function text(value, field, source) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${source} has no text at ${field}.`);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {string} source
 * @returns {number}
 */
function count(value, field, source) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 0) {
    throw new Error(`${source} has no count at ${field}.`);
  }
  return /** @type {number} */ (value);
}

/**
 * @typedef {Omit<PullRequest, "commits" | "changedFiles" | "lineChanges">} Header
 * @param {string} root
 * @param {Header} header
 * @param {string} fetchHint
 * @returns {PullRequest}
 */
function withHistory(root, header, fetchHint) {
  for (const commit of [header.baseSha, header.headSha]) {
    try {
      git(root, "cat-file", "-e", `${commit}^{commit}`);
    } catch {
      throw new Error(`Commit ${commit} of pull request #${header.number} is not in this clone. ${fetchHint}`);
    }
  }
  const lineChanges = numstat(git(root, "diff", "--numstat", "-z", `${header.baseSha}...${header.headSha}`));
  return {
    ...header,
    commits: commitsInRange(root, `${header.baseSha}..${header.headSha}`, "branch"),
    changedFiles: lineChanges.map(({ path }) => path),
    lineChanges,
  };
}

/**
 * A rename's line has an empty path, and the old and new paths follow as two more fields.
 * @param {string} output git diff --numstat -z
 * @returns {LineChange[]}
 */
function numstat(output) {
  const fields = output.split("\0");
  /** @type {LineChange[]} */
  const changes = [];
  for (let at = 0; at < fields.length; at++) {
    if (!fields[at]) continue;
    const [additions, deletions, path] = fields[at].split("\t");
    const renamed = path === "";
    changes.push({
      path: renamed ? fields[at + 2] : path,
      additions: Number(additions) || 0,
      deletions: Number(deletions) || 0,
    });
    if (renamed) at += 2;
  }
  return changes;
}

/**
 * @param {string} root
 * @param {string} path GITHUB_EVENT_PATH.
 * @returns {Subjects}
 */
export function subjectsFromEvent(root, path) {
  const event = JSON.parse(readFileSync(path, "utf8"));
  const source = "The GitHub event";
  const pr = event.pull_request;
  if (pr) {
    const pullRequest = withHistory(root, {
      number: count(pr.number, "pull_request.number", source),
      title: text(pr.title, "pull_request.title", source).trim(),
      body: text(pr.body, "pull_request.body", source),
      author: text(pr.user?.login, "pull_request.user.login", source),
      base: text(pr.base?.ref, "pull_request.base.ref", source),
      baseSha: sha(pr.base?.sha, "pull_request.base.sha", source),
      headSha: sha(pr.head?.sha, "pull_request.head.sha", source),
      additions: count(pr.additions, "pull_request.additions", source),
      deletions: count(pr.deletions, "pull_request.deletions", source),
    }, "Check out with fetch-depth: 0.");
    return { commits: pullRequest.commits, pr: pullRequest };
  }
  const isBranchPush = typeof event.ref === "string" && event.ref.startsWith("refs/heads/");
  if (!isBranchPush || typeof event.after !== "string") return { commits: null, pr: null };
  // A created or deleted branch has no earlier tip to compare with. Its pull request checks its commits.
  if (NO_COMMIT.test(event.before) || NO_COMMIT.test(event.after)) return { commits: null, pr: null };
  const range = `${sha(event.before, "before", source)}..${sha(event.after, "after", source)}`;
  return {
    commits: commitsInRange(root, range, TRUNKS.includes(event.ref) ? "trunk" : "branch"),
    pr: null,
  };
}

const GH_FIELDS = "number,title,body,author,baseRefName,baseRefOid,headRefOid,headRefName,additions,deletions";

/**
 * @param {string} root
 * @param {number} number
 * @returns {Subjects}
 */
export function subjectsFromGh(root, number) {
  const source = `gh pr view ${number}`;
  let raw;
  try {
    raw = execFileSync("gh", ["pr", "view", String(number), "--json", GH_FIELDS], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const { stderr = "", message } = /** @type {Error & { stderr?: string }} */ (error);
    throw new Error(`${source} failed. ${stderr.trim() || message}`);
  }
  const pr = JSON.parse(raw);
  const login = text(pr.author?.login, "author.login", source);
  const pullRequest = withHistory(root, {
    number: count(pr.number, "number", source),
    title: text(pr.title, "title", source).trim(),
    body: text(pr.body, "body", source),
    author: pr.author?.is_bot && login.startsWith("app/") ? `${login.slice(4)}[bot]` : login,
    base: text(pr.baseRefName, "baseRefName", source),
    baseSha: sha(pr.baseRefOid, "baseRefOid", source),
    headSha: sha(pr.headRefOid, "headRefOid", source),
    additions: count(pr.additions, "additions", source),
    deletions: count(pr.deletions, "deletions", source),
  }, `Fetch it: git fetch origin ${text(pr.baseRefName, "baseRefName", source)} ${text(pr.headRefName, "headRefName", source)}`);
  return { commits: pullRequest.commits, pr: pullRequest };
}
