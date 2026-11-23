import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, matchesGlob, relative, sep } from "node:path";

const SKIP = new Set([".git", "node_modules"]);

const roots = new Map();
const kinds = new Map();

function repoRoot(filename) {
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

function appKind(root, base) {
  const key = `${root}\0${base}`;
  if (kinds.has(key)) return kinds.get(key);
  const dir = join(root ?? "", base);
  const path = join(dir, "package.json");
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const kind =
    ["next", "astro", "expo", "vite"].find((name) => deps[name]) ?? (manifest.dependencies?.hono ? "hono" : null);
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

export const UI_APPS = new Set(["next", "vite", "expo", "astro"]);

export function stem(name) {
  return name.replace(/\.(?:[cm]?[jt]sx?|astro)$/, "");
}

export function inside(local, prefix) {
  return local === prefix || local.startsWith(`${prefix}/`);
}

export function isTest(name) {
  return /\.test\.[cm]?[jt]sx?$/.test(name);
}

export const DATABASE_SUITE = /\.(mongo|redis)\.test\.[cm]?[jt]sx?$/;

export function testedStem(name) {
  return /^(.+?)(?:\.(?:browser|mongo|redis))?\.test\.[cm]?[jt]sx?$/.exec(name)?.[1] ?? null;
}

export function isTestSupport(name) {
  return isTest(name) || /\.(?:fixture|test-utils)\.[cm]?[jt]sx?$/.test(name);
}

export function isGenerated(name) {
  return /\.d\.[cm]?ts$/.test(name) || /\.gen\.[cm]?[jt]sx?$/.test(name);
}

function moduleName(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function aliasPath(source) {
  return source.startsWith("#/") ? source.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/, "") : source;
}

export function moduleVisitors(callback) {
  return {
    ImportDeclaration(node) {
      callback(aliasPath(node.source.value), node, node.specifiers);
    },
    ExportNamedDeclaration(node) {
      if (node.source) callback(aliasPath(node.source.value), node, node.specifiers);
    },
    ExportAllDeclaration(node) {
      callback(aliasPath(node.source.value), node, []);
    },
    ImportExpression(node) {
      const name = moduleName(node.source);
      if (name) callback(aliasPath(name), node, []);
    },
  };
}

export function importedName(specifier) {
  if (specifier.type === "ImportSpecifier") return specifier.imported.name ?? specifier.imported.value;
  if (specifier.type === "ExportSpecifier") return specifier.local.name ?? specifier.local.value;
  return null;
}

function patternIds(pattern) {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern];
  if (pattern.type === "ObjectPattern")
    return pattern.properties.flatMap((item) => patternIds(item.type === "RestElement" ? item.argument : item.value));
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap((item) => patternIds(item));
  if (pattern.type === "RestElement") return patternIds(pattern.argument);
  if (pattern.type === "AssignmentPattern") return patternIds(pattern.left);
  return [];
}

export function exportedIds(node) {
  if (node.declaration?.type === "VariableDeclaration")
    return node.declaration.declarations.flatMap((item) => patternIds(item.id));
  if (node.declaration?.id) return [node.declaration.id];
  return (node.specifiers ?? []).map((specifier) => specifier.exported);
}

function ignoreRules(root, dir, file) {
  const path = join(root, dir, file);
  if (!existsSync(path)) return [];
  const rules = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    let pattern = negate ? line.slice(1) : line;
    const dirOnly = pattern.endsWith("/");
    pattern = pattern.replace(/\/$/, "");
    const anchored = pattern.includes("/");
    rules.push({ dir, pattern: pattern.replace(/^\//, ""), negate, dirOnly, anchored });
  }
  return rules;
}

function ignored(rules, rel, isDir) {
  let result = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.dir && !rel.startsWith(`${rule.dir}/`)) continue;
    const local = rule.dir ? rel.slice(rule.dir.length + 1) : rel;
    const target = rule.anchored ? local : local.slice(local.lastIndexOf("/") + 1);
    if (matchesGlob(target, rule.pattern)) result = !rule.negate;
  }
  return result;
}

export function listFiles(root) {
  const files = [];
  const walk = (dir, inherited) => {
    const rules = [...inherited, ...ignoreRules(root, dir, ".gitignore")];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (ignored(rules, rel, entry.isDirectory())) continue;
      if (entry.isDirectory()) walk(rel, rules);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk("", ignoreRules(root, ".git/info", "exclude"));
  return files.sort();
}

export function anchorFor(path, lintable) {
  for (let dir = path; ; dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "") {
    const prefix = dir ? `${dir}/` : "";
    const hit = lintable.find((file) => file.startsWith(prefix));
    if (hit) return hit;
    if (!dir) return null;
  }
}
