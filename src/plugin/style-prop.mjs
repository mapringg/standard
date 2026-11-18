function customPropertiesOnly(value) {
  const object = value?.type === "JSXExpressionContainer" ? value.expression : null;
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

export default {
  meta: {
    type: "problem",
    docs: { description: "The style prop only sets CSS custom properties; everything else is a class." },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "style" || customPropertiesOnly(node.value))
          return;
        context.report({
          node,
          message: 'Style with classes, and pass only CSS custom properties to style, like { "--progress": value }.',
        });
      },
    };
  },
};
