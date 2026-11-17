import { posix } from "node:path";

import { parseSync } from "oxc-parser";

import { git } from "../repo.mjs";
import { isNode, SKIPPED_KEYS, TYPE_WRAPPERS } from "./duplicates.mjs";
import { packageOf, TEST_FILE } from "./support/packages.mjs";

/**
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {import("../subjects.mjs").PullRequest} PullRequest
 *
 * @typedef {object} Change
 * @property {string} path At the head commit.
 * @property {string} package Folder of the nearest package.json at the head commit, "." for the root.
 * @property {"source" | "test"} role
 * @property {boolean} gained Whether the head has a logic statement the merge base lacks.
 */

const SOURCE = /(?:^|\/)src\/.*\.(?:ts|tsx|mts|cts)$/;
const NOT_SOURCE = /\.d\.[cm]?ts$|\.(?:stories|gen)\.[^/]+$|(?:^|\/)(?:test|tests|__tests__|generated)\//;
const RUNTIME_TS = new Set(["TSEnumDeclaration", "TSEnumBody", "TSEnumMember", "TSParameterProperty"]);
const IGNORED_KEYS = new Set([...SKIPPED_KEYS, "implements"]);
const DATA = new Set([
  "Literal",
  "ObjectExpression",
  "Property",
  "ArrayExpression",
  "TemplateLiteral",
  "TemplateElement",
  "Identifier",
  "VariableDeclaration",
  "VariableDeclarator",
  "SpreadElement",
  "UnaryExpression",
  "MemberExpression",
  "EmptyStatement",
]);

/**
 * @param {string} path
 * @returns {Change["role"] | null}
 */
function roleOf(path) {
  if (TEST_FILE.test(path)) return "test";
  return SOURCE.test(path) && !NOT_SOURCE.test(path) ? "source" : null;
}

/**
 * @param {unknown} value
 * @returns {unknown} The value without positions, raw text and types.
 */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (typeof value === "bigint") return `${value}n`;
  if (value === null || typeof value !== "object") return value;
  if (isNode(value)) {
    if (TYPE_WRAPPERS.has(value.type)) return strip(value.expression);
    if (value.type.startsWith("TS") && !RUNTIME_TS.has(value.type)) return null;
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED_KEYS.has(key)).map(([key, child]) => [key, strip(child)]));
}

/**
 * @param {unknown} value A stripped tree.
 * @returns {boolean} Whether it only declares constant data, such as a translation table.
 */
function isData(value) {
  if (Array.isArray(value)) return value.every(isData);
  if (value === null || typeof value !== "object") return true;
  if (isNode(value)) {
    if (!DATA.has(value.type)) return false;
    if (value.type === "Property" && (value.kind !== "init" || value.method)) return false;
  }
  return Object.values(value).every(isData);
}

/**
 * @param {string} path
 * @param {string} text
 * @returns {Set<string> | null} One fingerprint per top-level logic statement, or null when the file does not parse.
 */
function logic(path, text) {
  const { program, errors } = parseSync(path, text, { preserveParens: false });
  if (errors.length > 0) return null;
  /** @type {Set<string>} */
  const fingerprints = new Set();
  for (const statement of program.body) {
    const node =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration" ? statement.declaration : statement;
    if (!node || node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || (node.type.startsWith("TS") && !RUNTIME_TS.has(node.type))) continue;
    if ("declare" in node && node.declare === true) continue;
    const tree = strip(node);
    if (!isData(tree)) fingerprints.add(JSON.stringify(tree));
  }
  return fingerprints;
}

/**
 * @param {PullRequest} pr
 * @param {Repo} repo
 * @returns {Change[]}
 */
function changes(pr, repo) {
  const base = git(repo.root, "merge-base", pr.baseSha, pr.headSha);
  const manifests = new Set(
    git(repo.root, "ls-tree", "-r", "-z", "--name-only", pr.headSha)
      .split("\0")
      .filter((path) => posix.basename(path) === "package.json"),
  );
  const fields = git(repo.root, "diff", "--name-status", "-z", "-M", base, pr.headSha).split("\0");
  /** @type {Change[]} */
  const found = [];
  for (let at = 0; at < fields.length - 1; ) {
    const status = fields[at];
    const moved = /^[RC]/.test(status);
    const before = status === "A" ? null : fields[at + 1];
    const path = moved ? fields[at + 2] : fields[at + 1];
    at += moved ? 3 : 2;
    const role = roleOf(path);
    if (status === "D" || role === null) continue;
    const head = logic(path, repo.readAt(pr.headSha, path) ?? "");
    const old = before === null ? null : repo.readAt(base, before);
    const prior = (before === null || old === null ? null : logic(before, old)) ?? new Set();
    found.push({
      path,
      package: packageOf(manifests, path) ?? ".",
      role,
      gained: head === null ? role === "source" : [...head].some((fingerprint) => !prior.has(fingerprint)),
    });
  }
  return found;
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "pr-tests",
  since: "0.10.0",
  subject: "pr",
  retired: [],
  run(pr, repo) {
    /** @type {Map<string, { sources: string[], tested: boolean }>} */
    const packages = new Map();
    for (const change of changes(pr, repo).filter(({ gained }) => gained)) {
      const entry = packages.get(change.package) ?? { sources: [], tested: false };
      if (change.role === "source") entry.sources.push(change.path);
      else entry.tested = true;
      packages.set(change.package, entry);
    }
    return [...packages].flatMap(([folder, { sources, tested }]) => {
      if (tested || sources.length === 0) return [];
      const [first] = sources;
      const what = sources.length === 1 ? `${first} adds logic` : `${first} and ${sources.length - 1} more add logic`;
      const example = first.replace(/(\.[cm]?tsx?)$/, ".test$1");
      return [
        {
          key: folder,
          fix: `${what}, but no test in ${folder === "." ? "the root package" : folder} adds any. Add or change a test there, such as ${example}, that covers it.`,
        },
      ];
    });
  },
};
