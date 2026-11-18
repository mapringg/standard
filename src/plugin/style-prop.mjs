const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"]);

function unwrap(node) {
  let current = node;
  while (WRAPPERS.has(current?.type)) current = current.expression;
  return current;
}

function customPropertiesOnly(value) {
  const object = value?.type === "JSXExpressionContainer" ? unwrap(value.expression) : null;
  return (
    object?.type === "ObjectExpression" &&
    object.properties.every(
      (item) =>
        item.type === "Property" &&
        !item.computed &&
        item.key.type === "Literal" &&
        typeof item.key.value === "string" &&
        item.key.value.startsWith("--"),
    )
  );
}

function intrinsic(element) {
  return element.name.type === "JSXIdentifier" && /^[a-z]/.test(element.name.name);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "The style prop on a DOM element only sets CSS custom properties; everything else is a class.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "style" ||
          !intrinsic(node.parent) ||
          customPropertiesOnly(node.value)
        )
          return;
        context.report({
          node,
          message: 'Style with classes, and pass only CSS custom properties to style, like { "--progress": value }.',
        });
      },
    };
  },
};
