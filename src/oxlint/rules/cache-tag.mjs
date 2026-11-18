import { directives, moduleExports, isFunction, statements, walk } from "../functions.mjs";

/** @typedef {import("../functions.mjs").Node} Node */

const CACHE = /^use cache(?::|$)/;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "Every use cache scope is an inline function that calls cacheTag with a tag at its top level.", fix: "Call cacheTag(tag) at the top of the scope." }, schema: [], messages: { tag: "Call cacheTag from next/cache with at least one tag at the top of this use cache scope, and export each scope as an inline function, so a write can revalidate what it caches." } },
  create(context) {
    /** @type {Set<string>} */
    const tags = new Set();
    /** @param {Node} statement */
    const tagged = (statement) => {
      const expression = statement.type === "ExpressionStatement" ? statement.expression : undefined;
      return expression?.type === "CallExpression" && expression.callee.type === "Identifier" && tags.has(expression.callee.name) && expression.arguments.length > 0;
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "next/cache") return;
        for (const specifier of node.specifiers) if (specifier.type === "ImportSpecifier" && (specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value) === "cacheTag") tags.add(specifier.local.name);
      },
      "Program:exit"(program) {
        const file = directives(program).some((directive) => CACHE.test(directive));
        const { functions, others } = file ? moduleExports(program) : { functions: [], others: [] };
        const scopes = [...functions];
        for (const node of others) context.report({ node, messageId: "tag" });
        walk(program, (node) => { if (isFunction(node) && directives(node).some((directive) => CACHE.test(directive)) && !scopes.includes(node)) scopes.push(node); });
        for (const scope of scopes) if (!statements(scope).some(tagged)) context.report({ node: scope, messageId: "tag" });
      },
    };
  },
});
