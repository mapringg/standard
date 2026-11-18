import { locate, stem } from "./paths.mjs";

const BANNED_KEYS = new Set([
  "page",
  "skip",
  "offset",
  "search",
  "query",
  "sortBy",
  "sortOrder",
  "order",
  "startDate",
  "endDate",
]);

function keyName(property) {
  return property.key?.name ?? property.key?.value;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Params schemas use the standard names; LIFF routes validate search with them." },
  },
  create(context) {
    const where = locate(context.filename);
    const imports = new Map();
    const visitors = {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) imports.set(specifier.local.name, node.source.value);
      },
      Property(node) {
        if (where?.kind !== "liff" || keyName(node) !== "validateSearch") return;
        const value = node.value.type === "MemberExpression" ? node.value.object : node.value;
        const source = value.type === "Identifier" ? imports.get(value.name) : null;
        if (!source || !source.endsWith("-params"))
          context.report({ node, message: "validateSearch is the feature params schema from <feature>-params.ts." });
      },
    };
    if (stem(context.filename).endsWith("-params")) {
      visitors.CallExpression = (node) => {
        if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "object") return;
        for (const property of node.arguments[0]?.properties ?? []) {
          const key = keyName(property);
          if (key && ((key.length === 1 && key !== "q") || BANNED_KEYS.has(key))) {
            context.report({
              node: property,
              message: `Use the standard param names: q, sort, cursor, from/to, <field>From/<field>To, filters by field name. Not ${key}.`,
            });
          }
        }
      };
    }
    return visitors;
  },
};
