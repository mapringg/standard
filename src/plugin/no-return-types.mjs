import { isGenerated } from "./paths.mjs";

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Implementations infer their return types." },
  },
  create(context) {
    if (isGenerated(context.filename)) return {};
    const check = (node) => {
      const annotation = node.returnType?.typeAnnotation;
      if (!annotation || !node.body || annotation.type === "TSTypePredicate") return;
      context.report({
        node: node.returnType,
        message: "Drop the return type and let TypeScript infer it; use satisfies to pin a contract.",
      });
    };
    return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check };
  },
};
