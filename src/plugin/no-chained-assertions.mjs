const ASSERTIONS = new Set(["TSAsExpression", "TSTypeAssertion"]);

function isConst(node) {
  return node.typeAnnotation?.type === "TSTypeReference" && node.typeAnnotation.typeName?.name === "const";
}

export default {
  meta: {
    type: "problem",
    docs: { description: "No chained type assertions such as x as unknown as Y." },
  },
  create(context) {
    const check = (node) => {
      if (!ASSERTIONS.has(node.expression.type) || isConst(node) || isConst(node.expression)) return;
      context.report({
        node,
        message: "No chained type assertions. Parse the value with a zod schema at its boundary.",
      });
    };
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
};
