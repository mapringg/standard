import { posix } from "node:path";

import { dependents } from "./support/packages.mjs";
import { parseSource } from "./support/sources.mjs";

/**
 * @typedef {{ type: string, [key: string]: any }} Node
 *
 * What a config expression says about `cacheComponents` at its top level. `unread` is a value the check cannot read, and `hidden` is a
 * config it cannot read at all, with why.
 * @typedef {{ kind: "on" } | { kind: "missing" } | { kind: "off" | "unread" | "experimental", line: number } | { kind: "hidden", line: number, why: string }} Verdict
 */

const CONFIGS = ["ts", "mts", "mjs", "js", "cjs"].map((extension) => `next.config.${extension}`);
const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression"]);
const SET = "Set cacheComponents: true at the top level of the object it exports, as Next 16 reads it.";

/** @type {(node: Node) => Node} */
const unwrap = (node) => (WRAPPERS.has(node.type) ? unwrap(node.expression) : node);

/** @type {(node: Node) => string | null} */
const keyOf = (node) => (node.computed ? (node.key.type === "Literal" ? String(node.key.value) : null) : node.key.name ?? String(node.key.value));

/**
 * @param {Node} program
 * @param {(node: Node) => number} lineOf
 * @returns {Verdict} What the module's default export or `module.exports` sets.
 */
function verdictOf(program, lineOf) {
  /** @type {Map<string, Node>} */
  const consts = new Map(program.body.flatMap((/** @type {Node} */ node) => {
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    return declaration?.type === "VariableDeclaration" ? declaration.declarations.flatMap((/** @type {Node} */ item) => (item.id.type === "Identifier" && item.init ? [[item.id.name, item.init]] : [])) : [];
  }));
  const seen = /** @type {Set<Node>} */ (new Set());
  /** @type {(node: Node) => Verdict} */
  const read = (node) => {
    const value = unwrap(node);
    if (seen.has(value)) return { kind: "hidden", line: lineOf(value), why: "a name that refers to itself" };
    seen.add(value);
    switch (value.type) {
      case "ObjectExpression": return object(value);
      case "Identifier": return consts.has(value.name) ? read(/** @type {Node} */ (consts.get(value.name))) : { kind: "hidden", line: lineOf(value), why: "a name the check cannot trace" };
      case "CallExpression": {
        const config = value.arguments.filter((/** @type {Node} */ arg) => arg.type !== "SpreadElement").map(read).find((/** @type {Verdict} */ verdict) => verdict.kind !== "hidden");
        return config ?? { kind: "hidden", line: lineOf(value), why: "a call that takes no object it can read" };
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression": {
        if (value.body.type !== "BlockStatement") return read(value.body);
        const last = value.body.body.findLast((/** @type {Node} */ statement) => statement.type === "ReturnStatement" && statement.argument);
        return last ? read(last.argument) : { kind: "hidden", line: lineOf(value), why: "a function that returns no object at its top level" };
      }
      default: return { kind: "hidden", line: lineOf(value), why: "an expression that is not an object" };
    }
  };
  /** @type {(node: Node) => Verdict} Later properties and spreads replace earlier ones, as the object literal does. */
  const object = (node) => {
    /** @type {Verdict} */
    let verdict = { kind: "missing" };
    let experimental = /** @type {number | null} */ (null);
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        const spread = read(property.argument);
        if (spread.kind !== "missing") verdict = spread;
        continue;
      }
      const key = keyOf(property);
      const value = unwrap(property.value);
      if (key === "cacheComponents") {
        verdict = value.type === "Literal" && value.value === true ? { kind: "on" } : { kind: value.type === "Literal" && value.value === false ? "off" : "unread", line: lineOf(property) };
      }
      if (key === "experimental" && value.type === "ObjectExpression" && value.properties.some((/** @type {Node} */ item) => item.type === "Property" && keyOf(item) === "cacheComponents")) experimental = lineOf(property);
    }
    return verdict.kind === "missing" && experimental !== null ? { kind: "experimental", line: experimental } : verdict;
  };
  for (const node of program.body) {
    if (node.type === "ExportDefaultDeclaration") return read(node.declaration);
    const assigned = node.type === "ExpressionStatement" && node.expression.type === "AssignmentExpression" ? node.expression : null;
    if (assigned?.left.type === "MemberExpression" && assigned.left.object.name === "module" && assigned.left.property.name === "exports") return read(assigned.right);
  }
  return { kind: "hidden", line: 1, why: "no export default or module.exports" };
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "cache-components",
  since: "0.14.17",
  doc: {
    enforces: "Each Next app's `next.config.*` exports `cacheComponents: true` at its top level, read from the AST through local names, spreads, plugin calls and config functions. A config the check cannot read fails.",
    fix: "Set `cacheComponents: true` at the top level of the exported config. Stage the check in `pending` until the switch lands.",
    config: [],
  },
  subject: "tree",
  baseline: false,
  retired: [],
  applies: (repo) => (dependents(repo, "next").length > 0 ? { on: true } : { on: false, because: "no tracked package.json declares next" }),
  run(repo) {
    const tracked = new Set(repo.files());
    return dependents(repo, "next").flatMap((app) => {
      const path = CONFIGS.map((name) => posix.join(app, name)).find((candidate) => tracked.has(candidate));
      const key = `${app} cacheComponents`;
      if (path === undefined) return [{ key, fix: `${app} has no next.config file. Add next.config.ts that exports { cacheComponents: true }.` }];
      const text = repo.read(path);
      const { program, errors } = parseSource(path, text);
      if (errors.length > 0) return [{ key, fix: `${path} does not parse, so the check cannot read it: ${errors[0].message}. Fix the syntax.` }];
      const verdict = verdictOf(program, (node) => text.slice(0, node.start).split("\n").length);
      switch (verdict.kind) {
        case "on": return [];
        case "missing": return [{ key, fix: `${path} does not set cacheComponents. ${SET}` }];
        case "off": return [{ key, fix: `${path} sets cacheComponents on line ${verdict.line} to false. ${SET}` }];
        case "unread": return [{ key, fix: `${path} sets cacheComponents on line ${verdict.line} to a value the check cannot read. ${SET}` }];
        case "experimental": return [{ key, fix: `${path} sets cacheComponents under experimental on line ${verdict.line}. Next 16 reads it at the top level, so move it there.` }];
        default: return [{ key, fix: `${path} exports a config the check cannot read on line ${verdict.line}: ${verdict.why}. Export an object, or pass one to the plugin call, and set cacheComponents: true at its top level.` }];
      }
    });
  },
};
