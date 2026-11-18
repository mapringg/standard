import { directives, exportedFunctions, isFunction, statements, walk } from "../functions.mjs";

/** @typedef {import("../functions.mjs").Node} Node */

const CACHE = /^use cache(?::|$)/;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { tag: "Call cacheTag from next/cache at the top of this use cache scope, so a write can revalidate what it caches." } },
  create(context) {
    /** @type {Set<string>} */
    const tags = new Set();
    /** @param {Node} statement */
    const tagged = (statement) => {
      const expression = statement.type === "ExpressionStatement" ? statement.expression : undefined;
      return expression?.type === "CallExpression" && expression.callee.type === "Identifier" && tags.has(expression.callee.name);
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "next/cache") return;
        for (const specifier of node.specifiers) if (specifier.type === "ImportSpecifier" && (specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value) === "cacheTag") tags.add(specifier.local.name);
      },
      "Program:exit"(program) {
        /** @type {Node[]} */
        const scopes = directives(program).some((directive) => CACHE.test(directive)) ? exportedFunctions(program) : [];
        walk(program, (node) => { if (isFunction(node) && directives(node).some((directive) => CACHE.test(directive)) && !scopes.includes(node)) scopes.push(node); });
        for (const scope of scopes) if (!statements(scope).some(tagged)) context.report({ node: scope, messageId: "tag" });
      },
    };
  },
});
