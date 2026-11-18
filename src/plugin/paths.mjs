import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const roots = new Map();
const kinds = new Map();

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

export function appKind(root, base) {
  const key = `${root}\0${base}`;
  if (kinds.has(key)) return kinds.get(key);
  const dir = join(root ?? "", base);
  let kind = null;
  if (existsSync(join(dir, "src/factory.ts"))) kind = "api";
  else {
    const path = join(dir, "package.json");
    const manifest = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    if (deps.next) kind = "web";
    else if (deps.astro) kind = "marketing";
    else if (deps.expo) kind = "mobile";
    else if (deps.vite) kind = "liff";
  }
  kinds.set(key, kind);
  return kind;
}

export function describe(rel, root = null) {
  const parts = rel.split("/");
  const grouped = (parts[0] === "apps" || parts[0] === "packages") && parts.length > 2;
  const base = grouped ? `${parts[0]}/${parts[1]}` : null;
  const local = grouped ? parts.slice(2).join("/") : rel;
  const app = parts[0] === "apps" && grouped ? parts[1] : null;
  return {
    root,
    rel,
    name: parts.at(-1),
    app,
    kind: app ? appKind(root, base) : null,
    pkg: parts[0] === "packages" && grouped ? parts[1] : null,
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
  return /\.test\.[cm]?[jt]sx?$/.test(name);
}

export function isTestSupport(name) {
  return isTest(name) || /\.(?:fixture|test-utils)\.[cm]?[jt]sx?$/.test(name);
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
