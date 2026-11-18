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
            "Never export a cached function that takes a user id. Resolve the user inside with 'use cache: private'.",
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
      CallExpression(node) {
        const called = calleeName(node);
        const owner = nearestCached(node);
        if (owner && (called === "cacheTag" || called === "cacheLife")) cached.get(owner).add(called);
        const tag = node.arguments[0]?.type;
        if (TAGS.has(called) && !cacheFile && (tag === "Literal" || tag === "TemplateLiteral")) {
          context.report({ node, message: "Cache tags live in <feature>-cache.ts. Import the tag from there." });
        }
      },
      "Program:exit"(program) {
        for (const [node, calls] of cached) {
          if (!calls.has("cacheTag") || !calls.has("cacheLife"))
            context.report({ node, message: "Every 'use cache' function calls cacheTag and cacheLife." });
        }
        if (name.endsWith(".server") && !serverOnly)
          context.report({ node: program, message: '*.server.ts files import "server-only" first.' });
      },
    };
  },
};
