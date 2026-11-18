import { rolesOf } from "../roles.mjs";

/** @typedef {Parameters<NonNullable<ReturnType<NonNullable<Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]["create"]>>[string]>>[0]} Node */

const HOOKS = ["useEffect", "useLayoutEffect"];

/** @param {any} node @returns {boolean} */
const cleanup = (node) => ["ArrowFunctionExpression", "FunctionExpression", "Identifier"].includes(node?.type);

/** @param {any} node @param {boolean} top @returns {any[]} The return statements of one function body, without those of nested functions. */
function returns(node, top = true) {
  if (!node || typeof node !== "object") return [];
  if (!top && ["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(node.type)) return [];
  if (node.type === "ReturnStatement") return [node];
  return Object.entries(node).flatMap(([key, value]) => key === "parent" ? [] : Array.isArray(value) ? value.flatMap((item) => returns(item, false)) : returns(value, false));
}

/** @param {any} callback */
function returnsCleanup(callback) {
  if (!["ArrowFunctionExpression", "FunctionExpression"].includes(callback?.type)) return false;
  if (callback.body.type !== "BlockStatement") return false;
  const last = callback.body.body.at(-1);
  return last?.type === "ReturnStatement" && returns(callback.body).every((statement) => cleanup(statement.argument));
}

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { cleanup: "Write the subscription inline and return its cleanup on every path, as a function or the name of one: return () => target.removeEventListener(...) or return unsubscribe." } },
  create(context) {
    if (!rolesOf(context.filename).effect.includes("subscribe")) return {};
    /** @type {Set<string>} */
    const locals = new Set();
    /** @type {Set<string>} */
    const namespaces = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react" || node.importKind === "type") return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") namespaces.add(specifier.local.name);
          else if (HOOKS.includes(specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value)) locals.add(specifier.local.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const hook = callee.type === "Identifier" ? locals.has(callee.name) : callee.type === "MemberExpression" && callee.object.type === "Identifier" && namespaces.has(callee.object.name) && callee.property.type === "Identifier" && HOOKS.includes(callee.property.name);
        if (hook && !returnsCleanup(node.arguments[0])) context.report({ node, messageId: "cleanup" });
      },
    };
  },
});
