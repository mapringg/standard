import { posix } from "node:path";

import { parseSync } from "oxc-parser";

import { git } from "../repo.mjs";
import { packageOf, TEST_FILE } from "./support/packages.mjs";

/**
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {import("../subjects.mjs").PullRequest} PullRequest
 * @typedef {{ type: string, [key: string]: any }} Node
 *
 * One side of a changed file. Head content counts each fingerprint up and merge-base content counts it down,
 * so summing a package's sides leaves what the pull request adds there.
 * @typedef {object} Side
 * @property {string} path
 * @property {string} package Folder of the nearest package.json at the head commit, "." for the root.
 * @property {"source" | "test"} role
 * @property {Map<string, number>} counts Signed count of each logic statement or test registration.
 */

const SOURCE = /(?:^|\/)src\/.*\.(?:ts|tsx|mts|cts)$/;
const NOT_SOURCE = /\.d\.[cm]?ts$|\.(?:stories|gen)\.[^/]+$|(?:^|\/)(?:test|tests|__tests__|generated)\//;
const DROPPED_KEYS = new Set([
  "start",
  "end",
  "range",
  "loc",
  "raw",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "implements",
  "importKind",
  "exportKind",
  "abstract",
  "readonly",
  "override",
  "accessibility",
  "definite",
  "declare",
]);
const OPTIONAL_CHAINS = new Set(["MemberExpression", "CallExpression"]);
const TYPE_WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
const RUNTIME_TS = new Set([
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  "TSParameterProperty",
  "TSExportAssignment",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSQualifiedName",
]);
const MODIFIERS = new Set(["concurrent", "sequential", "each()"]);
const SKIP_OPTIONS = new Set(["skip", "todo", "only"]);

/**
 * @param {string} path
 * @returns {Side["role"] | null}
 */
function roleOf(path) {
  if (TEST_FILE.test(path)) return "test";
  return SOURCE.test(path) && !NOT_SOURCE.test(path) ? "source" : null;
}

/**
 * @param {unknown} value
 * @returns {value is Node}
 */
function isNode(value) {
  return value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";
}

/**
 * @param {unknown} value
 * @returns {any} The value as the JavaScript it emits, without positions, raw text and types, or null when it emits nothing.
 */
function emitted(value) {
  if (Array.isArray(value)) return value.flatMap((child) => (child === null ? [null] : [emitted(child)].filter((kept) => kept !== null)));
  if (typeof value === "bigint") return `${value}n`;
  if (value === null || typeof value !== "object") return value;
  if (isNode(value)) {
    if (TYPE_WRAPPERS.has(value.type)) return emitted(value.expression);
    if (value.declare === true || (value.type.startsWith("TS") && !RUNTIME_TS.has(value.type))) return null;
    if (value.type === "MethodDefinition" && value.value.type === "TSEmptyBodyFunctionExpression") return null;
  }
  const type = isNode(value) ? value.type : null;
  /** @type {Record<string, any>} */
  const kept = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !DROPPED_KEYS.has(key) && (key !== "optional" || (type !== null && OPTIONAL_CHAINS.has(type))))
      .map(([key, child]) => [key, emitted(child)]),
  );
  if (type === "ExportNamedDeclaration" && kept.declaration === null && kept.specifiers.length === 0) return null;
  if (type === "TSModuleDeclaration" && (kept.body?.body ?? []).length === 0) return null;
  return kept;
}

/**
 * @param {Node} node An emitted expression.
 * @returns {boolean} Whether evaluating it can run no code, as with a translation table. Reading a binding runs none; reading a property can call a getter.
 */
function isInert(node) {
  switch (node.type) {
    case "Literal":
    case "Identifier":
      return true;
    case "TemplateLiteral":
      return node.expressions.every(isInert);
    case "ArrayExpression":
      return node.elements.every((/** @type {Node | null} */ element) => element === null || isInert(element));
    case "ObjectExpression":
      return node.properties.every(
        (/** @type {Node} */ property) =>
          property.type === "Property" &&
          property.kind === "init" &&
          !property.method &&
          (!property.computed || property.key.type === "Literal") &&
          isInert(property.value),
      );
    case "UnaryExpression":
      return (node.operator === "-" || node.operator === "+") && node.argument.type === "Literal" && typeof node.argument.value === "number";
    default:
      return false;
  }
}

/**
 * @param {Node} node An emitted top-level statement, with export unwrapped.
 * @returns {boolean} Whether it only declares inert data.
 */
function isData(node) {
  if (node.type === "EmptyStatement") return true;
  if (node.type === "VariableDeclaration") {
    return node.declarations.every((/** @type {Node} */ { id, init }) => id.type === "Identifier" && (init === null || isInert(init)));
  }
  return isInert(node);
}

/**
 * @param {string} path
 * @param {string} text
 * @returns {Node[] | null} The top-level statements, or null when the file does not parse.
 */
function statements(path, text) {
  const { program, errors } = parseSync(path, text, { preserveParens: false });
  return errors.length > 0 ? null : program.body;
}

/**
 * @param {Map<string, number>} counts
 * @param {string} fingerprint
 * @param {number} [by]
 */
function add(counts, fingerprint, by = 1) {
  counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + by);
}

/**
 * @param {Node[]} body
 * @returns {Map<string, number>} One entry per top-level logic statement.
 */
function logic(body) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const statement of body) {
    const node = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration" ? statement.declaration : statement;
    if (node === null || node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration") continue;
    const tree = emitted(node);
    if (tree !== null && !isData(tree)) add(counts, JSON.stringify(tree));
  }
  return counts;
}

/**
 * @param {Node} callee
 * @returns {{ name: string, modifiers: string[] } | null} The name a test framework call starts from and the modifiers chained on it.
 */
function chain(callee) {
  if (callee.type === "Identifier") return { name: callee.name, modifiers: [] };
  if (callee.type === "MemberExpression" && !callee.computed) {
    const inner = chain(callee.object);
    return inner && { name: inner.name, modifiers: [...inner.modifiers, callee.property.name] };
  }
  if (callee.type === "CallExpression") {
    const inner = chain(callee.callee);
    return inner?.modifiers.at(-1) === "each" ? { name: inner.name, modifiers: [...inner.modifiers.slice(0, -1), "each()"] } : null;
  }
  return null;
}

/**
 * @param {Node} call
 * @returns {"suite" | "test" | null} What the call registers, or null for anything skipped, focused, pending or not a registration.
 */
function registration(call) {
  const found = chain(call.callee);
  if (found === null || !found.modifiers.every((modifier) => MODIFIERS.has(modifier))) return null;
  const optedOut = call.arguments.some(
    (/** @type {Node} */ argument) =>
      argument.type === "ObjectExpression" &&
      argument.properties.some((/** @type {Node} */ property) => property.type === "Property" && SKIP_OPTIONS.has(property.key.name ?? property.key.value)),
  );
  if (optedOut) return null;
  if (found.name === "describe" || found.name === "suite") return "suite";
  return found.name === "it" || found.name === "test" ? "test" : null;
}

/**
 * @param {Node[]} body
 * @param {Map<string, number>} [counts]
 * @returns {Map<string, number>} One entry per test that runs a body, inside suites too.
 */
function registrations(body, counts = new Map()) {
  for (const statement of body) {
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "CallExpression") continue;
    const call = statement.expression;
    const kind = registration(call);
    const callback = call.arguments.findLast((/** @type {Node} */ argument) => argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression");
    if (kind === null || callback === undefined) continue;
    const block = callback.body.type === "BlockStatement" ? callback.body.body : null;
    if (kind === "suite") {
      if (block !== null) registrations(block, counts);
    } else if (block === null || block.length > 0) {
      add(counts, JSON.stringify(emitted(call)));
    }
  }
  return counts;
}

/**
 * @param {Side["role"]} role
 * @param {string} path
 * @param {string} text
 * @param {1 | -1} by 1 for the head, -1 for the merge base.
 * @returns {Map<string, number>}
 */
function countsOf(role, path, text, by) {
  const body = statements(path, text);
  if (body === null) return role === "source" && by === 1 ? new Map([[`unparsed ${path}`, 1]]) : new Map();
  const counts = role === "test" ? registrations(body) : logic(body);
  return by === 1 ? counts : new Map([...counts].map(([fingerprint, count]) => [fingerprint, -count]));
}

/**
 * @param {PullRequest} pr
 * @param {Repo} repo
 * @returns {Side[]}
 */
function sides(pr, repo) {
  const base = git(repo.root, "merge-base", pr.baseSha, pr.headSha);
  const manifests = new Set(
    git(repo.root, "ls-tree", "-r", "-z", "--name-only", pr.headSha)
      .split("\0")
      .filter((path) => posix.basename(path) === "package.json"),
  );
  /** @type {Side[]} */
  const found = [];
  const side = (/** @type {string} */ path, /** @type {string} */ commit, /** @type {1 | -1} */ by) => {
    const role = roleOf(path);
    if (role === null) return;
    found.push({ path, package: packageOf(manifests, path) ?? ".", role, counts: countsOf(role, path, repo.readAt(commit, path) ?? "", by) });
  };
  const fields = git(repo.root, "diff", "--name-status", "-z", "-M", base, pr.headSha).split("\0");
  for (let at = 0; at < fields.length - 1; ) {
    const status = fields[at];
    if (status.startsWith("R")) {
      side(fields[at + 1], base, -1);
      side(fields[at + 2], pr.headSha, 1);
      at += 3;
      continue;
    }
    if (status !== "A") side(fields[at + 1], base, -1);
    if (status !== "D") side(fields[at + 1], pr.headSha, 1);
    at += 2;
  }
  return found;
}

/**
 * @param {Side[]} group
 * @returns {Map<string, number>}
 */
function net(group) {
  /** @type {Map<string, number>} */
  const total = new Map();
  for (const { counts } of group) for (const [fingerprint, count] of counts) add(total, fingerprint, count);
  return total;
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "pr-tests",
  since: "0.10.0",
  subject: "pr",
  retired: [],
  run(pr, repo) {
    return [...Map.groupBy(sides(pr, repo), (side) => side.package)].flatMap(([folder, group]) => {
      const tests = net(group.filter(({ role }) => role === "test"));
      if ([...tests.values()].some((count) => count > 0)) return [];
      const logic = net(group.filter(({ role }) => role === "source"));
      const sources = group
        .filter(({ role, counts }) => role === "source" && [...counts].some(([fingerprint, count]) => count > 0 && (logic.get(fingerprint) ?? 0) > 0))
        .map(({ path }) => path);
      if (sources.length === 0) return [];
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
