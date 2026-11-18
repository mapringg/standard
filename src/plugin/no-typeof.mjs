function isUndefinedProbe(node) {
  const parent = node.parent;
  if (parent?.type !== "BinaryExpression" || !["===", "!==", "==", "!="].includes(parent.operator)) return false;
  const other = parent.left === node ? parent.right : parent.left;
  return other.type === "Literal" && other.value === "undefined";
}

export default {
  meta: {
    type: "problem",
    docs: { description: "No runtime typeof narrowing; parse at the boundary instead." },
  },
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator !== "typeof" || isUndefinedProbe(node)) return;
        context.report({
          node,
          message: "No runtime typeof checks. Parse the value with a zod schema at its boundary.",
        });
      },
    };
  },
};
