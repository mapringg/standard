import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {object} Config
 * @property {{ "pre-commit": readonly string[], "pre-push": readonly string[] }} hooks Shell lines each hook runs after its built-in rule.
 * @property {readonly string[]} pending Checks this repo has not adopted yet. They do not run.
 */

const FILE = "standard.json";

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
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      throw new Error(
        `${FILE} has an unknown key "${dotted(key)}". Known keys: ${known.map(dotted).join(", ")}.`,
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
  const top = section(raw, "", ["hooks", "pending"]);
  const hooks = section(top.hooks ?? {}, "hooks", ["pre-commit", "pre-push"]);
  return Object.freeze({
    hooks: Object.freeze({
      "pre-commit": strings(hooks["pre-commit"] ?? [], `${FILE} hooks.pre-commit`),
      "pre-push": strings(hooks["pre-push"] ?? [], `${FILE} hooks.pre-push`),
    }),
    pending: strings(top.pending ?? [], `${FILE} pending`),
  });
}

/**
 * @param {string} root
 * @returns {Config}
 */
export function loadConfig(root) {
  const path = join(root, FILE);
  return parseConfig(existsSync(path) ? readFileSync(path, "utf8") : "{}");
}
