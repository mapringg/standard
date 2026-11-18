import { directives, isFunction, moduleExports, statements, walk } from "../functions.mjs";
import { projectFile } from "../browser.mjs";

/** @typedef {import("../functions.mjs").Node} Node */

const ZOD = /^zod(?:\/|$)/;
const PARSE = new Set(["parse", "parseAsync"]);

/** @param {Node} node @returns {string | undefined} The identifier a member chain or call chain starts from. */
const root = (node) => node?.type === "Identifier" ? node.name : node?.type === "MemberExpression" ? root(node.object) : node?.type === "CallExpression" ? root(node.callee) : undefined;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: {
    type: "problem", docs: { description: "Every Server Action is an inline exported function that parses each argument first with a schema from the project's own files or a module const built from the validator.", fix: "Parse each argument with schema.parse before anything else." },
    schema: [],
    messages: {
      schema: "Parse {{params}} with a schema before anything else, such as const input = schema.parse(raw), or schema.parse(Object.fromEntries(formData)) for a form, using the validator this file imports: zod, zod/mini or valibot.",
      inline: "Export each Server Action as an inline async function, export async function name(raw) {}, so its arguments can be checked.",
    },
  },
  create(context) {
    let zod = false;
    /** @type {Set<string>} */
    const namespaces = new Set();
    /** @type {Set<string>} */
    const functions = new Set();
    /** @type {Set<string>} Bindings imported from the project's own files, and module-level consts built from a validator namespace: the only receivers a parse may use. */
    const schemas = new Set();
    /** @param {Node} node */
    const schema = (node) => node?.type === "Identifier" && schemas.has(node.name);
    /** @param {Node} call @returns {Node | undefined} The value a throwing validator call parses. */
    const parsed = (call) => {
      if (call?.type === "AwaitExpression") return parsed(call.argument);
      if (call?.type !== "CallExpression") return undefined;
      const callee = call.callee;
      if (callee.type === "Identifier") return functions.has(callee.name) && schema(call.arguments[0]) ? call.arguments[1] : undefined;
      if (callee.type !== "MemberExpression" || callee.computed || !PARSE.has(callee.property.name)) return undefined;
      if (callee.object.type === "Identifier" && namespaces.has(callee.object.name)) return schema(call.arguments[0]) ? call.arguments[1] : undefined;
      return zod && schema(callee.object) ? call.arguments[0] : undefined;
    };
    /** @param {Node} value @returns {string | undefined} The parameter a parsed value reads, whole or through Object.fromEntries. */
    const reads = (value) => value?.type === "Identifier" ? value.name : value?.type === "CallExpression" && value.callee.type === "MemberExpression" && root(value.callee) === "Object" && value.callee.property.name === "fromEntries" && value.arguments.length === 1 ? reads(value.arguments[0]) : undefined;
    /** @param {Node} statement */
    const parses = (statement) => statement.type === "ExpressionStatement" ? [parsed(statement.expression)] : statement.type === "VariableDeclaration" ? statement.declarations.map((/** @type {Node} */ item) => parsed(item.init)) : [undefined];
    /** @param {Node} fn */
    const check = (fn) => {
      /** @type {Set<string>} */
      const done = new Set();
      for (const statement of statements(fn)) {
        const names = parses(statement).map(reads);
        if (names.some((/** @type {string | undefined} */ name) => name === undefined)) break;
        for (const name of names) done.add(/** @type {string} */ (name));
      }
      const missing = fn.params.filter((/** @type {Node} */ param) => param.type !== "Identifier" || !done.has(param.name));
      if (missing.length) context.report({ node: fn, messageId: "schema", data: { params: missing.map((/** @type {Node} */ param) => param.type === "Identifier" ? param.name : "each destructured argument").join(", ") } });
    };
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const validator = ZOD.test(source) || source === "valibot";
        zod ||= ZOD.test(source);
        for (const specifier of node.specifiers) {
          if (!validator) { if (node.importKind !== "type" && projectFile(context.filename, source)) schemas.add(specifier.local.name); continue; }
          if (specifier.type !== "ImportSpecifier") namespaces.add(specifier.local.name);
          else {
            const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
            if (["z", "v"].includes(name)) namespaces.add(specifier.local.name);
            else if (PARSE.has(name)) functions.add(specifier.local.name);
          }
        }
      },
      "Program:exit"(program) {
        for (const node of program.body) {
          const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
          if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;
          for (const item of declaration.declarations) if (item.id.type === "Identifier" && namespaces.has(root(item.init) ?? "")) schemas.add(item.id.name);
        }
        const file = directives(program).includes("use server");
        const { functions: actions, others } = file ? moduleExports(program) : { functions: [], others: [] };
        for (const node of others) context.report({ node, messageId: "inline" });
        walk(program, (node) => { if (isFunction(node) && directives(node).includes("use server") && !actions.includes(node)) actions.push(node); });
        actions.forEach(check);
      },
    };
  },
});
