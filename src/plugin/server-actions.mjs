import { stem } from "./paths.mjs";

function directives(body) {
  const found = [];
  for (const node of body ?? []) {
    if (node.type !== "ExpressionStatement" || typeof node.directive !== "string") break;
    found.push(node);
  }
  return found;
}

function exportedNames(node) {
  if (node.declaration?.type === "VariableDeclaration") return node.declaration.declarations.map((item) => item.id);
  if (node.declaration?.id) return [node.declaration.id];
  return node.specifiers.map((specifier) => specifier.exported);
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Server Actions live only in <feature>-actions.ts and their names end in Action." },
  },
  create(context) {
    const actions = stem(context.filename).endsWith("-actions");
    const inline = (node) => {
      const found = directives(node.body?.body).find((item) => item.directive === "use server");
      if (found)
        context.report({
          node: found,
          message: "No inline Server Actions. Export the action from <feature>-actions.ts.",
        });
    };
    return {
      Program(program) {
        const top = directives(program.body).find((item) => item.directive === "use server");
        if (top && !actions)
          context.report({ node: top, message: "'use server' belongs only in <feature>-actions.ts." });
        if (actions && !top)
          context.report({ node: program, message: "<feature>-actions.ts starts with 'use server'." });
      },
      FunctionDeclaration: inline,
      FunctionExpression: inline,
      ArrowFunctionExpression: inline,
      ExportNamedDeclaration(node) {
        if (!actions || node.exportKind === "type" || node.declaration?.type?.startsWith("TS")) return;
        for (const id of exportedNames(node)) {
          const name = id.name ?? id.value;
          if (!name.endsWith("Action"))
            context.report({ node: id, message: `Server Action names end in Action: ${name}Action.` });
        }
      },
      ExportDefaultDeclaration(node) {
        if (actions) context.report({ node, message: "Server Actions are named exports ending in Action." });
      },
    };
  },
};
