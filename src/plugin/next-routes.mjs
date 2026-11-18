import { locate, stem } from "./paths.mjs";

function defaultFunction(program) {
  const exported = program.body.find((node) => node.type === "ExportDefaultDeclaration")?.declaration;
  if (!exported) return null;
  if (exported.type !== "Identifier") return exported;
  for (const node of program.body) {
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type === "FunctionDeclaration" && declaration.id?.name === exported.name) return declaration;
    if (declaration?.type === "VariableDeclaration") {
      const found = declaration.declarations.find((item) => item.id.name === exported.name);
      if (found) return found.init;
    }
  }
  return null;
}

function insideFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(current.type)) return true;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Next pages and layouts are synchronous; pages take PageProps." },
  },
  create(context) {
    const where = locate(context.filename);
    if (where?.kind !== "web" || !where.local.startsWith("src/app/")) return {};
    const file = stem(where.name);
    if (file !== "page" && file !== "layout") return {};
    const label = `${file}.tsx`;
    return {
      AwaitExpression(node) {
        if (!insideFunction(node))
          context.report({
            node,
            message: `Move the top-level await out of ${label} into a feature component inside <Section>.`,
          });
      },
      Program(program) {
        const component = defaultFunction(program);
        if (!component) return;
        if (component.async)
          context.report({
            node: component,
            message: `Make ${label} synchronous and move async work into a feature component inside <Section>.`,
          });
        const props = component.params?.[0];
        if (
          file === "page" &&
          props &&
          !context.sourceCode.getText(props.typeAnnotation ?? props).includes("PageProps")
        ) {
          context.report({ node: props, message: 'Type page props as PageProps<"/route">.' });
        }
      },
    };
  },
};
