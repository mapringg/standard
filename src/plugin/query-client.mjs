import { UI_APPS, locate } from "./paths.mjs";

const FUNCTION = new Set(["FunctionExpression", "ArrowFunctionExpression"]);

function resolve(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable;
  }
  return null;
}

function isFunction(node, scope) {
  if (FUNCTION.has(node.type)) return true;
  if (node.type !== "Identifier") return false;
  const definition = resolve(scope, node.name)?.defs[0];
  if (definition?.type === "FunctionName" || definition?.type === "ImportBinding") return true;
  const init = definition?.type === "Variable" ? definition.node.init : null;
  return Boolean(init && FUNCTION.has(init.type));
}
const MESSAGE = "Pass retry a function that retries once and never retries 400, 401, 403, 404, 409, 413, 415 or 422 errors.";

export default {
  meta: {
    type: "problem",
    docs: { description: "The query client in lib/query.ts retries with a function that skips client errors." },
  },
  create(context) {
    const where = locate(context.filename);
    if (!UI_APPS.has(where?.kind) || where.local !== "src/lib/query.ts") return {};
    const clients = [];
    let retries = false;
    return {
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "QueryClient") clients.push(node);
      },
      Property(node) {
        if ((node.key?.name ?? node.key?.value) !== "retry") return;
        retries = true;
        if (!isFunction(node.value, context.sourceCode.getScope(node))) context.report({ node: node.value, message: MESSAGE });
      },
      "Program:exit"() {
        if (!retries) for (const node of clients) context.report({ node, message: MESSAGE });
      },
    };
  },
};
