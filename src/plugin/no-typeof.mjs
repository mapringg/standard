function isUndefinedProbe(node) {
  const parent = node.parent;
  if (parent?.type !== "BinaryExpression" || !["===", "!==", "==", "!="].includes(parent.operator)) return false;
  const other = parent.left === node ? parent.right : parent.left;
  return other.type === "Literal" && other.value === "undefined";
}

import { inside, locate } from "./paths.mjs";

export default {
  meta: {
    type: "problem",
    docs: { description: "No runtime typeof narrowing outside lib/ serializers; parse at the boundary instead." },
  },
  create(context) {
    if (inside(locate(context.filename)?.local ?? "", "src/lib")) return {};
    return {
      UnaryExpression(node) {
        if (node.operator !== "typeof" || isUndefinedProbe(node)) return;
        context.report({
          node,
          message: "Parse the value with a zod schema at its boundary; typeof belongs only in lib/ serializers.",
        });
      },
    };
  },
};
