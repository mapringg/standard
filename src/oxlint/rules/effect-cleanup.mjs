import { rolesOf } from "../roles.mjs";
import { hookName } from "../hooks.mjs";

/** @typedef {Parameters<NonNullable<ReturnType<NonNullable<Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]["create"]>>[string]>>[0]} Node */

const INLINE = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

/** @param {any} node @param {boolean} top @returns {any[]} The return statements of one function body, without those of nested functions. */
function returns(node, top = true) {
  if (!node || typeof node !== "object") return [];
  if (!top && ["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(node.type)) return [];
  if (node.type === "ReturnStatement") return [node];
  return Object.entries(node).flatMap(([key, value]) => key === "parent" ? [] : Array.isArray(value) ? value.flatMap((item) => returns(item, false)) : returns(value, false));
}

/** @param {any} callback Whether an effect callback returns an inline cleanup on every path. */
export function returnsCleanup(callback) {
  if (!INLINE.has(callback?.type) || callback.async || callback.generator || callback.body.type !== "BlockStatement") return false;
  const body = callback.body.body;
  /** @type {Set<string>} The consts the callback's own body binds to an inline function. */
  const bound = new Set(body.flatMap((/** @type {any} */ statement) => statement.type === "VariableDeclaration" && statement.kind === "const" ? statement.declarations.flatMap((/** @type {any} */ item) => item.id.type === "Identifier" && INLINE.has(item.init?.type) ? [item.id.name] : []) : []));
  const cleanup = (/** @type {any} */ node) => INLINE.has(node?.type) || node?.type === "Identifier" && bound.has(node.name);
  return body.at(-1)?.type === "ReturnStatement" && returns(callback.body).every((statement) => cleanup(statement.argument));
}

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "Every effect in an .effect-subscribe file is inline and returns a function cleanup on every path.", fix: "End every path with return () => unsubscribe()." }, schema: [], messages: { cleanup: "Write the subscription inline and end every path with return () => unsubscribe(), or return a const that holds such a function." } },
  create(context) {
    if (!rolesOf(context.filename).effect.includes("subscribe")) return {};
    return {
      CallExpression(node) {
        if (hookName(context, node.callee) && !returnsCleanup(node.arguments[0])) context.report({ node, messageId: "cleanup" });
      },
    };
  },
});
