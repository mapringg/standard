import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDocument } from "yaml";

/**
 * @typedef {object} Config
 * @property {{ "pre-commit": readonly string[], "pre-push": readonly string[] }} hooks Shell lines each hook runs after its built-in rule.
 * @property {readonly string[]} pending Checks this repo has not adopted yet. They do not run.
 * @property {PullRequestConfig} pr
 *
 * @typedef {{ "ticket-prefix"?: string, screenshots?: { when: readonly string[], uploader: string } }} PullRequestConfig
 * `ticket-prefix` is the tracker's key, such as "ABC" in `Ticket: ABC-12`. Absent means the repo has no tickets.
 * A pull request that changes a file matching a `screenshots.when` glob needs a screenshot in Evidence; `uploader` is the repo script that uploads one.
 */

export const FILE = ".standard/config.json";

const LEGACY = "standard.json";

/**
 * @param {string} key
 * @returns {string}
 */
function kebab(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * @param {unknown} value
 * @param {string} keyPath
 * @param {string[]} known
 * @returns {Record<string, unknown>}
 */
function section(value, keyPath, known) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${[FILE, keyPath].join(" ").trim()} must be an object.`);
  }
  const dotted = (/** @type {string} */ key) => (keyPath ? `${keyPath}.${key}` : key);
  const knownKeys = `Known keys: ${known.map(dotted).join(", ")}.`;
  for (const key of Object.keys(value)) {
    if (/[A-Z]/.test(key)) {
      const name = kebab(key);
      throw new Error(
        `"${key}" in ${FILE} is camelCase; name it "${name}".${known.includes(name) ? "" : ` ${knownKeys}`}`,
      );
    }
    if (!known.includes(key)) {
      throw new Error(
        `${FILE} has an unknown key "${dotted(key)}". ${knownKeys}`,
      );
    }
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} at
 * @returns {readonly string[]}
 */
function strings(value, at) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${at} must be a list of non-empty strings.`);
  }
  return Object.freeze([...value]);
}

const TICKET_PREFIX = /^[A-Z][A-Z0-9]*$/;

/**
 * @param {unknown} value
 * @param {string} at
 * @returns {string}
 */
function repoPath(value, at) {
  if (typeof value !== "string" || value === "" || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`${at} must be a path relative to the repository root, such as scripts/upload.mjs.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {PullRequestConfig}
 */
function pullRequest(value) {
  const pr = section(value, "pr", ["ticket-prefix", "screenshots"]);
  /** @type {PullRequestConfig} */
  const parsed = {};
  const prefix = pr["ticket-prefix"];
  if (prefix !== undefined) {
    if (typeof prefix !== "string" || !TICKET_PREFIX.test(prefix)) {
      throw new Error(`${FILE} pr.ticket-prefix must be capital letters and digits, such as "ABC".`);
    }
    parsed["ticket-prefix"] = prefix;
  }
  if (pr.screenshots !== undefined) {
    const screenshots = section(pr.screenshots, "pr.screenshots", ["when", "uploader"]);
    const when = strings(screenshots.when, `${FILE} pr.screenshots.when`);
    if (!when.some((glob) => !glob.startsWith("!"))) {
      throw new Error(`${FILE} pr.screenshots.when must list at least one glob that does not start with "!".`);
    }
    parsed.screenshots = Object.freeze({
      when,
      uploader: repoPath(screenshots.uploader, `${FILE} pr.screenshots.uploader`),
    });
  }
  return Object.freeze(parsed);
}

/**
 * @param {string} text
 * @returns {Config}
 */
export function parseConfig(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${FILE} is not valid JSON: ${/** @type {Error} */ (error).message}`);
  }
  const duplicate = parseDocument(text).errors.find((error) => error.code === "DUPLICATE_KEY");
  if (duplicate) {
    const { line, col } = duplicate.linePos?.[0] ?? { line: 0, col: 0 };
    throw new Error(`${FILE} repeats a key at line ${line}, column ${col}. Keep one copy of each key.`);
  }
  const top = section(raw, "", ["hooks", "pending", "pr"]);
  const hooks = section(top.hooks ?? {}, "hooks", ["pre-commit", "pre-push"]);
  return Object.freeze({
    hooks: Object.freeze({
      "pre-commit": strings(hooks["pre-commit"] ?? [], `${FILE} hooks.pre-commit`),
      "pre-push": strings(hooks["pre-push"] ?? [], `${FILE} hooks.pre-push`),
    }),
    pending: strings(top.pending ?? [], `${FILE} pending`),
    pr: pullRequest(top.pr ?? {}),
  });
}

/**
 * @param {Config} config
 * @param {readonly string[]} checks Names of the checks in this version.
 * @returns {string | null} Why the runner refuses this config, or null when it accepts it.
 */
export function pendingProblem(config, checks) {
  const unknown = config.pending.find((name) => !checks.includes(name));
  if (unknown) {
    return `${FILE} pending names "${unknown}", which is not a check in this version. Checks: ${checks.join(", ")}.`;
  }
  if (config.pending.includes("baseline-growth")) {
    return `${FILE} pending names baseline-growth, which guards pending itself. Remove it from pending.`;
  }
  return null;
}

/**
 * @param {string} root
 * @param {(path: string) => boolean} tracks Whether git tracks a repo path.
 * @returns {Config}
 */
export function loadConfig(root, tracks) {
  if (tracks(LEGACY)) {
    throw new Error(`${LEGACY} is tracked at the repository root. Move it to ${FILE}.`);
  }
  for (const part of [".standard", FILE]) {
    const path = join(root, part);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      throw new Error(`${part} is a symlink. Make it a regular ${part === FILE ? "file" : "folder"}, so every check reads the same config.`);
    }
  }
  const path = join(root, FILE);
  return parseConfig(existsSync(path) ? readFileSync(path, "utf8") : "{}");
}
