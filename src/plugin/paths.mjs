import { existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const roots = new Map();

export function repoRoot(filename) {
  const start = dirname(filename);
  if (roots.has(start)) return roots.get(start);
  let root = null;
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) {
      root = dir;
      break;
    }
    if (dirname(dir) === dir) break;
  }
  roots.set(start, root);
  return root;
}

export function locate(filename) {
  const root = repoRoot(filename);
  if (!root) return null;
  return describe(relative(root, filename).split(sep).join("/"), root);
}

export function describe(rel, root = null) {
  const parts = rel.split("/");
  const inside = parts[0] === "apps" || parts[0] === "packages";
  const kind = inside && parts.length > 2 ? parts[1] : null;
  const base = kind ? `${parts[0]}/${kind}` : null;
  const local = kind ? parts.slice(2).join("/") : rel;
  const name = parts.at(-1);
  return {
    root,
    rel,
    name,
    kind: parts[0] === "apps" ? kind : null,
    pkg: parts[0] === "packages" ? kind : null,
    base,
    local,
    feature: /^src\/features\/([^/]+)\//.exec(local)?.[1] ?? null,
  };
}

export const UI_APPS = new Set(["web", "liff", "mobile", "marketing"]);

export function stem(name) {
  return name.replace(/\.(?:[cm]?[jt]sx?|astro)$/, "");
}

export function inside(local, prefix) {
  return local === prefix || local.startsWith(`${prefix}/`);
}

export function isTest(name) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);
}

export function isGenerated(name) {
  return /\.d\.[cm]?ts$/.test(name) || /\.gen\.[cm]?[jt]sx?$/.test(name);
}

export function moduleName(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

export function moduleVisitors(callback) {
  return {
    ImportDeclaration(node) {
      callback(node.source.value, node, node.specifiers);
    },
    ExportNamedDeclaration(node) {
      if (node.source) callback(node.source.value, node, node.specifiers);
    },
    ExportAllDeclaration(node) {
      callback(node.source.value, node, []);
    },
    ImportExpression(node) {
      const name = moduleName(node.source);
      if (name) callback(name, node, []);
    },
  };
}

export function importedName(specifier) {
  if (specifier.type === "ImportSpecifier") return specifier.imported.name ?? specifier.imported.value;
  if (specifier.type === "ExportSpecifier") return specifier.local.name ?? specifier.local.value;
  return null;
}
