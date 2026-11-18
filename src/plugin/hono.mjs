import { locate } from "./paths.mjs";

const METHODS = new Set(["get", "post", "patch", "delete"]);
const LOOSE = new Set(["on", "all"]);
const CHAIN = new Set([...METHODS, ...LOOSE, "put", "route", "use", "onError", "notFound", "basePath"]);
const RAW = new Set(["query", "queries", "param", "json", "text", "formData", "parseBody", "arrayBuffer", "blob"]);
const RAW_BODY = new Set(["text", "arrayBuffer", "blob"]);
const STATUS = new Set(["json", "body"]);
const STREAMS = new Set(["streamSSE", "streamText", "stream"]);
const OPENAPI = new Set(["openAPIRouteHandler", "openAPISpecs", "generateSpecs", "Scalar"]);
const FUNCTION = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const HANDLERS = new Set(["createHandlers", "createMiddleware"]);
const KEBAB = "[a-z]+(?:-[a-z]+)*";
const MOUNT = new RegExp(`^/api/${KEBAB}$`);
const PATH = new RegExp(`^/(?:${KEBAB}|:id)?$`);
const POST_PATH = new RegExp(`^/(?:${KEBAB}|:id(?:/${KEBAB})?)?$`);
const OAUTH_PATH = new RegExp(`^/(?:\\.well-known(?:/${KEBAB})+|mcp-oauth/${KEBAB}|authorize|token|register|revoke)$`);
const OAUTH_MOUNT = /^\/(?:\.well-known|mcp-oauth)?$/;
const MAX_LINES = 10;

function property(node) {
  return node?.type === "MemberExpression" && !node.computed ? node.property.name : null;
}

function calls(node, name) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name;
}

function stringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function isDevelopmentTest(test) {
  if (test?.type !== "BinaryExpression" || !["===", "!=="].includes(test.operator)) return null;
  const sides = [test.left, test.right];
  const env = sides.some((side) => property(side) === "NODE_ENV");
  const value = sides.some((side) => stringValue(side) === "development");
  return env && value ? test.operator : null;
}

function inDevelopmentBranch(node) {
  for (let child = node, current = node.parent; current; child = current, current = current.parent) {
    if (current.type === "IfStatement" || current.type === "ConditionalExpression") {
      const operator = isDevelopmentTest(current.test);
      if (operator === "===" && child === current.consequent) return true;
      if (operator === "!==" && child === current.alternate) return true;
    }
    if (
      current.type === "LogicalExpression" &&
      current.operator === "&&" &&
      child === current.right &&
      isDevelopmentTest(current.left) === "==="
    )
      return true;
  }
  return false;
}

function inStream(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "CallExpression" && current.callee.type === "Identifier" && STREAMS.has(current.callee.name))
      return true;
  }
  return false;
}

function contextIndex(fn) {
  const call = fn.parent;
  if (call?.type !== "CallExpression" || !call.arguments.includes(fn)) return -1;
  const name = call.callee.type === "Identifier" ? call.callee.name : property(call.callee);
  if (name === "onError") return 1;
  return CHAIN.has(name) || HANDLERS.has(name) ? 0 : -1;
}

function isContext(node) {
  if (node?.type !== "Identifier") return false;
  for (let current = node.parent; current; current = current.parent) {
    if (!FUNCTION.has(current.type)) continue;
    const index = current.params.findIndex((param) => param.type === "Identifier" && param.name === node.name);
    if (index !== -1) return index === contextIndex(current);
  }
  return false;
}

function chainRoot(node) {
  let current = node;
  while (current?.type === "CallExpression" && current.callee.type === "MemberExpression") {
    if (property(current.callee) === "createApp") return true;
    current = current.callee.object;
  }
  return current?.type === "Identifier" ? current.name : false;
}

function isApp(node) {
  if (node?.type === "NewExpression") return node.callee.type === "Identifier" && node.callee.name === "Hono";
  return chainRoot(node) === true;
}

function validates(node, target) {
  return calls(node, "v") && stringValue(node.arguments[0]) === target;
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
    const app = where.local === "src/app.ts";
    const webhook = where.feature === "webhooks";
    const protocol = where.feature === "oauth";
    const report = (node, message) => context.report({ node, message });
    const routers = new Set();
    const oauthRouters = new Set();
    const isRouter = (object) => {
      const root = chainRoot(object);
      return root === true || routers.has(root);
    };
    const route = (node, method) => {
      if (LOOSE.has(method)) {
        report(node.callee.property, "Register each route with get, post, patch or delete.");
        return;
      }
      const path = stringValue(node.arguments[0]);
      if (path === null) report(node.arguments[0] ?? node, "Write the route path as a string literal.");
      else if (!(method === "post" ? POST_PATH : PATH).test(path) && !(protocol && OAUTH_PATH.test(path)))
        report(node.arguments[0], "Use /, /:id, /<kebab-name> or POST /:id/<kebab-verb> as the path.");
      if (!node.arguments.some((arg) => calls(arg, "describeRoute")))
        report(node.callee.property, "Add describeRoute with the response schemas from schema.ts to this route.");
      if (
        node.arguments.some((arg) => validates(arg, "form")) &&
        !node.arguments.some((arg) => calls(arg, "bodyLimit"))
      )
        report(node.callee.property, 'Add bodyLimit({ maxSize }) before v("form", schema) to cap the upload size.');
      if (protocol) return;
      const handler = node.arguments.at(-1);
      if (!FUNCTION.has(handler?.type)) report(handler ?? node, "Write the handler inline as the last argument.");
      else if (handler.loc.end.line - handler.loc.start.line + 1 > MAX_LINES)
        report(handler, `Move the logic into db.ts or service.ts so the handler fits in ${MAX_LINES} lines.`);
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value.startsWith("#/features/oauth/"))
          for (const specifier of node.specifiers) oauthRouters.add(specifier.local.name);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && isApp(node.init)) routers.add(node.id.name);
      },
      ExpressionStatement(node) {
        const call = node.expression;
        if (
          (routes || app) &&
          call.type === "CallExpression" &&
          CHAIN.has(property(call.callee)) &&
          call.callee.object.type === "Identifier" &&
          routers.has(call.callee.object.name)
        )
          report(node, "Build each router as one chain: factory.createApp().get(...).post(...).");
      },
      CallExpression(node) {
        const method = property(node.callee);
        const object = node.callee.object;
        const onContext = isContext(object);
        if (STATUS.has(method) && onContext && node.arguments.length < 2 && !inStream(node))
          report(node, `Pass the status explicitly: c.${method}(body, 200).`);
        if (RAW.has(method) && property(object) === "req" && !(webhook && RAW_BODY.has(method)))
          report(node, "Validate with v() from #/lib/validate and read the input with c.req.valid().");
        if (node.callee.type === "Identifier" && OPENAPI.has(node.callee.name) && !inDevelopmentBranch(node))
          report(node, 'Mount the OpenAPI spec and docs only inside env.NODE_ENV === "development".');
        if (method === "route" && app) {
          const path = stringValue(node.arguments[0]);
          const router = node.arguments[1];
          const oauth = router?.type === "Identifier" && oauthRouters.has(router.name);
          if (path === null || !(MOUNT.test(path) || (oauth && OAUTH_MOUNT.test(path))))
            report(node.arguments[0] ?? node, "Mount routers at /api/<plural-kebab>.");
        }
        if (routes && (METHODS.has(method) || LOOSE.has(method)) && isRouter(object)) route(node, method);
      },
    };
  },
};
