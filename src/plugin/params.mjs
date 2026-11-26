import { locate, stem } from "./paths.mjs";

const FIXED = new Set(["q", "sort", "cursor", "from", "to", "range"]);
const SYNONYMS = new Set([
  "page",
  "skip",
  "offset",
  "limit",
  "search",
  "query",
  "keyword",
  "term",
  "sortBy",
  "sortOrder",
  "order",
  "orderBy",
  "direction",
  "start",
  "end",
  "startDate",
  "endDate",
  "since",
  "until",
  "before",
  "after",
  "preset",
  "period",
]);
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;

function allowed(key) {
  return FIXED.has(key) || (key.length > 1 && CAMEL.test(key) && !SYNONYMS.has(key));
}

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
        if (where?.kind !== "vite" || keyName(node) !== "validateSearch") return;
        const value = node.value.type === "MemberExpression" ? node.value.object : node.value;
        const source = value.type === "Identifier" ? imports.get(value.name) : null;
        if (!source || !source.replace(/\.[cm]?[jt]sx?$/, "").endsWith("-params"))
          context.report({ node, message: "Set validateSearch to the params schema from <feature>-params.ts." });
      },
    };
    if (stem(context.filename).endsWith("-params")) {
      visitors.CallExpression = (node) => {
        if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "object") return;
        for (const property of node.arguments[0]?.properties ?? []) {
          const key = keyName(property);
          if (key && !allowed(key)) {
            context.report({
              node: property,
              message: `Rename ${key} to a standard param name: q, sort, cursor, from, to, range, <field>From, <field>To or a camelCase field name.`,
            });
          }
        }
      };
    }
    return visitors;
  },
};
