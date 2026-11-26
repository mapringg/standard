import { exportedIds, stem } from "./paths.mjs";

function directives(body) {
  const found = [];
  for (const node of Array.isArray(body) ? body : []) {
    if (node.type !== "ExpressionStatement" || typeof node.directive !== "string") break;
    found.push(node);
  }
  return found;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Server Actions live only in <feature>-actions.ts and their names end in Action." },
  },
  create(context) {
    const named = stem(context.filename).endsWith("-actions");
    const actions = named && /\.[cm]?ts$/.test(context.filename);
    const inline = (node) => {
      const found = directives(node.body?.body).find((item) => item.directive === "use server");
      if (found)
        context.report({
          node: found,
          message: "Export the action from <feature>-actions.ts instead of defining it inline.",
        });
    };
    return {
      Program(program) {
        const top = directives(program.body).find((item) => item.directive === "use server");
        if (top && !actions)
          context.report({
            node: top,
            message: "Move the action into <feature>-actions.ts, the only file with 'use server'.",
          });
        if (named && !actions)
          context.report({
            node: program,
            message:
              "Rename this component file so it does not end in -actions; <feature>-actions.ts holds only Server Actions.",
          });
        if (actions && !top)
          context.report({ node: program, message: "Start <feature>-actions.ts with 'use server'." });
      },
      FunctionDeclaration: inline,
      FunctionExpression: inline,
      ArrowFunctionExpression: inline,
      ExportNamedDeclaration(node) {
        if (!actions || node.exportKind === "type" || node.declaration?.type?.startsWith("TS")) return;
        for (const id of exportedIds(node)) {
          const name = id.name ?? id.value;
          if (!name.endsWith("Action")) context.report({ node: id, message: `Rename the action to ${name}Action.` });
        }
      },
      ExportDefaultDeclaration(node) {
        if (actions) context.report({ node, message: "Export the action by name, ending in Action." });
      },
    };
  },
};
