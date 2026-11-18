import { moduleVisitors, stem } from "./paths.mjs";

const FUNCTION = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];
const TAGS = new Set(["cacheTag", "updateTag", "revalidateTag"]);

function directiveList(body) {
  const found = [];
  for (const node of body ?? []) {
    if (node.type !== "ExpressionStatement" || typeof node.directive !== "string") break;
    found.push(node.directive);
  }
  return found;
}

function calleeName(node) {
  if (node.callee.type === "Identifier") return node.callee.name;
  if (node.callee.type === "MemberExpression" && !node.callee.computed) return node.callee.property.name;
  return null;
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent)
    if (FUNCTION.includes(current.type)) return current;
  return null;
}

function isExported(node) {
  const parent = node.parent;
  if (parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration") return true;
  return parent?.type === "VariableDeclarator" && parent.parent?.parent?.type === "ExportNamedDeclaration";
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Cached functions tag and time their cache; tags live in <feature>-cache.ts; server files import server-only.",
    },
  },
  create(context) {
    const name = stem(context.filename);
    const cacheFile = name.endsWith("-cache");
    const cached = new Map();
    const routers = new Set();
    let fileCached = false;
    let serverOnly = false;
    const enter = (node) => {
      const own = directiveList(node.body?.body).some((directive) => directive.startsWith("use cache"));
      if (!own && !(fileCached && !enclosingFunction(node))) return;
      cached.set(node, new Set());
      if (isExported(node) && node.params.some((param) => /^user(?:Id)?$/i.test(param.name ?? ""))) {
        context.report({
          node,
          message:
            "Resolve the user inside the function with 'use cache: private' instead of exporting a cached function that takes a user id.",
        });
      }
    };
    const nearestCached = (node) => {
      for (let current = node.parent; current; current = current.parent) if (cached.has(current)) return current;
      return null;
    };
    return {
      Program(program) {
        const top = directiveList(program.body);
        fileCached = top.some((directive) => directive.startsWith("use cache"));
      },
      ...Object.fromEntries(FUNCTION.map((type) => [type, enter])),
      ...moduleVisitors((source) => {
        if (source === "server-only") serverOnly = true;
      }),
      VariableDeclarator(node) {
        if (
          node.id.type === "Identifier" &&
          node.init?.type === "CallExpression" &&
          calleeName(node.init) === "useRouter"
        )
          routers.add(node.id.name);
      },
      CallExpression(node) {
        const called = calleeName(node);
        if (called === "refresh" && node.callee.type === "MemberExpression") {
          const object = node.callee.object;
          const named = object.type === "Identifier" && object.name !== "router" && routers.has(object.name);
          if (named || (object.type === "CallExpression" && calleeName(object) === "useRouter")) {
            context.report({
              node,
              message: "Update the cache in the Server Action with updateTag or refresh() instead of router.refresh().",
            });
          }
        }
        const owner = nearestCached(node);
        if (owner && (called === "cacheTag" || called === "cacheLife")) cached.get(owner).add(called);
        const tag = node.arguments[0]?.type;
        if (TAGS.has(called) && !cacheFile && (tag === "Literal" || tag === "TemplateLiteral")) {
          context.report({ node, message: "Import the cache tag from <feature>-cache.ts." });
        }
      },
      "Program:exit"(program) {
        for (const [node, calls] of cached) {
          if (!calls.has("cacheTag") || !calls.has("cacheLife"))
            context.report({ node, message: "Call cacheTag and cacheLife inside this 'use cache' function." });
        }
        if (name.endsWith(".server") && !serverOnly)
          context.report({ node: program, message: '*.server.ts files import "server-only" first.' });
      },
    };
  },
};
