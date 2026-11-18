import { locate } from "./paths.mjs";

export default {
  meta: {
    type: "problem",
    docs: { description: "Only src/lib/env.ts reads import.meta.env." },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where?.kind || where.local === "src/lib/env.ts" || /^[^/]+\.config\./.test(where.local)) return {};
    return {
      MemberExpression(node) {
        if (node.object.type === "MetaProperty" && node.property.name === "env") {
          context.report({
            node,
            message: "Environment variables belong to src/lib/env.ts. Use it through that file.",
          });
        }
      },
    };
  },
};
