import { isGenerated } from "./paths.mjs";

function binding(node) {
  if (node.id) return { owner: node, name: node.id.name };
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.init === node && parent.id.type === "Identifier")
    return { owner: parent, name: parent.id.name };
  return null;
}

function recursive(context, node) {
  const found = binding(node);
  if (!found) return false;
  const [start, end] = node.body.range;
  return context.sourceCode
    .getDeclaredVariables(found.owner)
    .filter((variable) => variable.name === found.name)
    .some((variable) =>
      variable.references.some(({ identifier }) => {
        const call = identifier.parent;
        return (
          call?.type === "CallExpression" &&
          call.callee === identifier &&
          identifier.range[0] >= start &&
          identifier.range[1] <= end
        );
      }),
    );
}

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Implementations infer their return types, except functions that call themselves." },
  },
  create(context) {
    if (isGenerated(context.filename)) return {};
    const check = (node) => {
      const annotation = node.returnType?.typeAnnotation;
      if (!annotation || !node.body || annotation.type === "TSTypePredicate" || recursive(context, node)) return;
      context.report({
        node: node.returnType,
        message: "Drop the return type and let TypeScript infer it; use satisfies to pin a contract.",
      });
    };
    return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check };
  },
};
