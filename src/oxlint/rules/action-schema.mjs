import { directives, exportedFunctions, isFunction, statements, walk } from "../functions.mjs";

/** @typedef {import("../functions.mjs").Node} Node */

const ZOD = /^zod(?:\/|$)/;
const PARSE = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync"]);

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { schema: "Parse each argument with a schema before anything else, such as const input = schema.parse(raw), using the validator this file imports: zod, zod/mini or valibot." } },
  create(context) {
    let zod = false;
    /** @type {Set<string>} */
    const namespaces = new Set();
    /** @type {Set<string>} */
    const functions = new Set();
    /** @param {Node} call @returns {Node | undefined} The value a validator call parses. */
    const parsed = (call) => {
      if (call?.type === "AwaitExpression") return parsed(call.argument);
      if (call?.type !== "CallExpression") return undefined;
      const callee = call.callee;
      if (callee.type === "Identifier") return functions.has(callee.name) ? call.arguments[1] : undefined;
      if (callee.type !== "MemberExpression" || callee.computed || !PARSE.has(callee.property.name)) return undefined;
      if (callee.object.type === "Identifier" && namespaces.has(callee.object.name)) return call.arguments[1];
      return zod ? call.arguments[0] : undefined;
    };
    /** @param {Node} statement */
    const parses = (statement) => statement.type === "ExpressionStatement" ? [parsed(statement.expression)] : statement.type === "VariableDeclaration" ? statement.declarations.map((/** @type {Node} */ item) => parsed(item.init)) : [undefined];
    /** @param {Node} fn */
    const check = (fn) => {
      if (fn.params.length === 0) return;
      /** @type {Set<string>} */
      const done = new Set();
      for (const statement of statements(fn)) {
        const values = parses(statement);
        if (values.some((/** @type {Node} */ value) => value?.type !== "Identifier")) break;
        for (const value of values) done.add(value.name);
      }
      if (!fn.params.every((/** @type {Node} */ param) => param.type === "Identifier" && done.has(param.name))) context.report({ node: fn, messageId: "schema" });
    };
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (!ZOD.test(source) && source !== "valibot") return;
        zod ||= ZOD.test(source);
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") namespaces.add(specifier.local.name);
          else {
            const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
            if (["z", "v"].includes(name)) namespaces.add(specifier.local.name);
            else if (PARSE.has(name)) functions.add(specifier.local.name);
          }
        }
      },
      "Program:exit"(program) {
        /** @type {Node[]} */
        const actions = directives(program).includes("use server") ? exportedFunctions(program) : [];
        walk(program, (node) => { if (isFunction(node) && directives(node).includes("use server") && !actions.includes(node)) actions.push(node); });
        actions.forEach(check);
      },
    };
  },
});
