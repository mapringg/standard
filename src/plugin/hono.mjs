import { locate } from "./paths.mjs";

const METHODS = new Set(["get", "post", "patch", "delete"]);
const CHAIN = new Set([...METHODS, "put", "route", "use", "on", "all", "onError", "notFound", "basePath"]);
const RAW = new Set(["query", "queries", "param", "json", "text", "formData", "parseBody", "arrayBuffer", "blob"]);
const OPENAPI = new Set(["openAPIRouteHandler", "openAPISpecs", "generateSpecs", "Scalar"]);
const FUNCTION = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const MAX_LINES = 10;

function property(node) {
  return node.type === "MemberExpression" && !node.computed ? node.property.name : null;
}

function calls(node, name) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name;
}

function stringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function inDevelopmentBranch(node, source) {
  for (let current = node.parent; current; current = current.parent) {
    if (["IfStatement", "ConditionalExpression", "LogicalExpression"].includes(current.type)) {
      const test = current.type === "LogicalExpression" ? current.left : current.test;
      if (source.getText(test).includes("development")) return true;
    }
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Hono routers are one chain of small documented handlers with explicit statuses." },
  },
  create(context) {
    const where = locate(context.filename);
    if (where?.kind !== "api") return {};
    const routes = /^src\/features\/[^/]+\/routes\.ts$/.test(where.local);
    const source = context.sourceCode;
    return {
      ExpressionStatement(node) {
        const call = node.expression;
        if (
          call.type !== "CallExpression" ||
          !CHAIN.has(property(call.callee)) ||
          call.callee.object.type !== "Identifier"
        )
          return;
        if (!routes && where.local !== "src/app.ts") return;
        context.report({ node, message: "Build each router as one chain: factory.createApp().get(...).post(...)." });
      },
      CallExpression(node) {
        const method = property(node.callee);
        const object = node.callee.object;
        if (method === "json" && object?.type === "Identifier" && object.name === "c" && node.arguments.length < 2) {
          context.report({ node, message: "Pass the status explicitly: c.json(body, 200)." });
        }
        if (RAW.has(method) && object?.type === "MemberExpression" && property(object) === "req") {
          context.report({ node, message: "Read input only through c.req.valid() after v() from @/lib/validate." });
        }
        if (node.callee.type === "Identifier" && OPENAPI.has(node.callee.name) && !inDevelopmentBranch(node, source)) {
          context.report({ node, message: "Mount the OpenAPI spec and docs only when NODE_ENV is development." });
        }
        if (method === "route" && where.local === "src/app.ts") {
          const path = stringValue(node.arguments[0]);
          if (path !== null && !/^\/api\/[a-z]+(?:-[a-z]+)*$/.test(path))
            context.report({ node: node.arguments[0], message: "Mount routers at /api/<plural-kebab>." });
        }
        if (!routes || !METHODS.has(method) || stringValue(node.arguments[0]) === null) return;
        const path = stringValue(node.arguments[0]);
        const shape = method === "post" ? /^\/(?::id(?:\/[a-z]+(?:-[a-z]+)*)?)?$/ : /^\/(?::id)?$/;
        if (!shape.test(path))
          context.report({
            node: node.arguments[0],
            message: "Paths are / and /:id, plus POST /:id/<verb> for actions.",
          });
        if (!node.arguments.some((arg) => calls(arg, "describeRoute")))
          context.report({ node, message: "Every route has describeRoute with its response schemas from schema.ts." });
        const handler = node.arguments.at(-1);
        if (!FUNCTION.has(handler.type))
          context.report({ node: handler, message: "Write the handler inline as the last argument." });
        else if (handler.loc.end.line - handler.loc.start.line + 1 > MAX_LINES) {
          context.report({
            node: handler,
            message: `A route handler is at most ${MAX_LINES} lines. Move the logic into db.ts or service.ts.`,
          });
        }
      },
    };
  },
};
