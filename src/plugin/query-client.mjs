import { UI_APPS, locate } from "./paths.mjs";

const FUNCTION = new Set(["FunctionExpression", "ArrowFunctionExpression", "Identifier"]);
const MESSAGE = "Pass retry a function that never retries 400, 401, 403 or 422 errors.";

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
        if (!FUNCTION.has(node.value.type)) context.report({ node: node.value, message: MESSAGE });
      },
      "Program:exit"() {
        if (!retries) for (const node of clients) context.report({ node, message: MESSAGE });
      },
    };
  },
};
