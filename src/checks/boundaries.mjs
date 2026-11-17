import { realpathSync } from "node:fs";
import { posix } from "node:path";

import { parseSync } from "oxc-parser";

import { projects, resolveAsset } from "./support/resolve.mjs";

/**
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {import("./support/resolve.mjs").Mode} Mode
 *
 * @typedef {object} Workspace A folder with a tracked package.json, "." for the root.
 * @property {string} dir
 * @property {string | null} name
 * @property {boolean} exports Whether its package.json has an exports field.
 * @property {boolean} module Whether its package.json sets "type": "module".
 * @property {ReadonlySet<string>} declares Package names its dependency lists name, with @types/ stripped.
 *
 * @typedef {"static" | "dynamic" | "require"} Kind How the file imports: a declaration, an import(), or require() and import x = require().
 * @typedef {{ specifier: string, kind: Kind }} Request
 *
 * @typedef {object} Edge An import whose target is a repo file.
 * @property {string} file
 * @property {string} specifier
 * @property {string} target
 * @property {() => string | null} unaliased The repo file the specifier resolves to without tsconfig paths, as a package name resolves outside the project.
 *
 * @typedef {{ file: string, specifier: string, rule: string, fix: string }} Problem
 * @typedef {{ workspaces: readonly Workspace[] }} Context
 * @typedef {{ name: string, check(edge: Edge, context: Context): string | null }} Rule
 */

const SOURCE = /\.[cm]?[jt]sx?$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DEPENDENCIES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/**
 * @param {string} path
 * @returns {string[]} Every folder that holds the path, nearest first, ending with ".".
 */
function folders(path) {
  const found = [];
  for (let dir = posix.dirname(path); dir !== "."; dir = posix.dirname(dir)) found.push(dir);
  return [...found, "."];
}

/**
 * @param {string} specifier
 * @returns {string} The package name a bare specifier starts with.
 */
function packageName(specifier) {
  const parts = specifier.split("/");
  return parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

/**
 * @param {readonly Workspace[]} workspaces Deepest folder first.
 * @param {string} path
 * @returns {Workspace}
 */
function workspaceOf(workspaces, path) {
  const holders = new Set(folders(path));
  return /** @type {Workspace} */ (workspaces.find(({ dir }) => holders.has(dir)));
}

/**
 * @param {Repo} repo
 * @returns {Workspace[]}
 */
function workspacesOf(repo) {
  const manifests = repo.files("**/package.json").filter((path) => !path.split("/").includes("node_modules"));
  /** @type {Workspace[]} */
  const found = manifests.map((path) => {
    /** @type {Record<string, unknown>} */
    let manifest;
    try {
      manifest = JSON.parse(repo.read(path));
    } catch (error) {
      throw new Error(`boundaries could not read ${path}. ${/** @type {Error} */ (error).message}`);
    }
    const declares = DEPENDENCIES.flatMap((field) => Object.keys(/** @type {object} */ (manifest[field] ?? {})));
    return {
      dir: posix.dirname(path),
      name: typeof manifest.name === "string" ? manifest.name : null,
      exports: manifest.exports !== undefined,
      module: manifest.type === "module",
      declares: new Set(declares.map((name) => name.replace(/^@types\/(?:([^_]+)__)?/, (_, scope) => (scope ? `@${scope}/` : "")))),
    };
  });
  if (!found.some(({ dir }) => dir === ".")) found.push({ dir: ".", name: null, exports: false, module: false, declares: new Set() });
  return found.sort((a, b) => b.dir.split("/").length - a.dir.split("/").length);
}

/** @type {readonly Rule[]} */
const RULES = [
  {
    name: "packages",
    check({ file, specifier, target, unaliased }, { workspaces }) {
      const to = workspaceOf(workspaces, target);
      if (to === workspaceOf(workspaces, file)) return null;
      const where = to.dir === "." ? "the root package" : to.dir;
      if (to.name === null || packageName(specifier) !== to.name) {
        const as = to.name ? `"${to.name}" or a subpath its exports list` : "its package name, after you give its package.json a name and exports";
        return `${target} belongs to ${where}, so import it as ${as}, not by path.`;
      }
      if (!to.exports && specifier !== to.name) {
        return `${to.name} has no exports field, so "${specifier}" reaches into its files. Add the subpath to exports in ${posix.join(to.dir, "package.json")}, or import "${to.name}".`;
      }
      const exported = unaliased();
      if (exported !== target) {
        const through = exported === null ? "lists no such subpath" : `resolve it to ${exported}`;
        return `"${specifier}" reaches ${target} through tsconfig paths, but the exports of ${to.name} ${through}. Import a subpath its exports list, or add this one there.`;
      }
      return null;
    },
  },
];

/**
 * @param {any} node
 * @returns {string | null} The decoded text of a string literal or a template literal without expressions.
 */
function literal(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked ?? null;
  return null;
}

/**
 * @param {any} node
 * @returns {Request | null}
 */
function requestOf(node) {
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportAllDeclaration":
    case "ExportNamedDeclaration": {
      const specifier = node.source ? literal(node.source) : null;
      return specifier === null ? null : { specifier, kind: "static" };
    }
    case "ImportExpression": {
      const specifier = literal(node.source);
      return specifier === null ? null : { specifier, kind: "dynamic" };
    }
    case "TSImportEqualsDeclaration": {
      const specifier = node.moduleReference.type === "TSExternalModuleReference" ? literal(node.moduleReference.expression) : null;
      return specifier === null ? null : { specifier, kind: "require" };
    }
    case "CallExpression": {
      const required = node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments.length === 1;
      const specifier = required ? literal(node.arguments[0]) : null;
      return specifier === null ? null : { specifier, kind: "require" };
    }
    default:
      return null;
  }
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {{ requests: Request[] } | { error: string }} Every import with a fixed specifier. An import() or require() of a computed value has none, as for TypeScript.
 */
function importsOf(file, text) {
  const { errors, program } = parseSync(file, text);
  if (errors.length > 0) return { error: errors[0].message };
  /** @type {Map<string, Request>} */
  const requests = new Map();
  /** @param {unknown} node */
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== "object" || !("type" in node)) return;
    const request = requestOf(node);
    if (request) requests.set(`${request.kind} ${request.specifier}`, request);
    for (const [key, value] of Object.entries(node)) {
      if (key !== "loc" && key !== "range" && typeof value === "object" && value !== null) visit(value);
    }
  };
  visit(program);
  return { requests: [...requests.values()] };
}

/**
 * @param {string} file
 * @param {Kind} kind
 * @param {Workspace} workspace
 * @param {"node" | "bundler"} moduleResolution
 * @returns {Mode} As TypeScript picks it: require() is require, import() is import, and under node16 or nodenext a declaration follows the file's own format.
 */
function modeOf(file, kind, workspace, moduleResolution) {
  if (kind !== "static") return kind === "require" ? "require" : "import";
  if (moduleResolution === "bundler") return "import";
  if (/\.[cm][jt]s$/.test(file)) return /\.m[jt]s$/.test(file) ? "import" : "require";
  return workspace.module ? "import" : "require";
}

/**
 * @param {Repo} repo
 * @returns {string[]}
 */
function sources(repo) {
  return repo.files().filter((path) => SOURCE.test(path) && !path.split("/").includes("node_modules"));
}

/**
 * @param {Repo} repo
 * @returns {Promise<Problem[]>} Every import that breaks a rule, cannot be resolved, or sits in a file that does not parse.
 */
export async function scan(repo) {
  const root = realpathSync(repo.root);
  const projectOf = await projects(root, repo.files("**/tsconfig.json").filter((path) => !path.split("/").includes("node_modules")));
  const context = { workspaces: workspacesOf(repo) };
  const workspaceNames = new Set(context.workspaces.flatMap(({ name }) => (name ? [name] : [])));
  const inRepo = (/** @type {string | null} */ path) => {
    if (path === null) return null;
    const relative = posix.relative(root, path);
    return relative.startsWith("../") || relative.split("/").includes("node_modules") ? null : relative;
  };
  /** @type {Problem[]} */
  const problems = [];
  for (const file of sources(repo)) {
    const found = importsOf(file, repo.read(file));
    if ("error" in found) {
      problems.push({ file, specifier: "", rule: "parse", fix: `${file} does not parse, so its imports cannot be checked: ${found.error} Fix the syntax.` });
      continue;
    }
    const absolute = posix.join(root, file);
    const project = projectOf(file);
    const from = workspaceOf(context.workspaces, file);
    const declared = (/** @type {string} */ name) => from.declares.has(name) || workspaceOf(context.workspaces, ".").declares.has(name);
    for (const { specifier, kind } of found.requests) {
      if (SCHEME.test(specifier)) continue;
      const mode = modeOf(file, kind, from, project.moduleResolution);
      const resolved = project.resolve(absolute, specifier, mode, true) ?? resolveAsset(absolute, specifier, true);
      if (resolved === "builtin") continue;
      if (resolved !== null) {
        const target = inRepo(resolved);
        if (target === null) continue;
        const unaliased = () => {
          const path = project.resolve(absolute, specifier, mode, false) ?? resolveAsset(absolute, specifier, false);
          return path === "builtin" ? null : inRepo(path);
        };
        for (const rule of RULES) {
          const fix = rule.check({ file, specifier, target, unaliased }, context);
          if (fix) problems.push({ file, specifier, rule: rule.name, fix });
        }
        continue;
      }
      const bare = !/^[./#]/.test(specifier);
      const name = packageName(specifier);
      if (bare && !workspaceNames.has(name) && declared(name)) continue;
      const manifest = posix.join(from.dir, "package.json");
      const fix = !bare
        ? `"${specifier}" in ${file} does not resolve. Fix the path so it names a file.`
        : workspaceNames.has(name)
          ? `"${specifier}" is not in the exports of the workspace package ${name}. Import a subpath its exports list, or add this one there.`
          : `"${specifier}" in ${file} does not resolve, and ${manifest} does not declare ${name}. Fix the tsconfig paths alias it uses, or add ${name} to ${manifest} and install it.`;
      problems.push({ file, specifier, rule: "unresolved", fix });
    }
  }
  return problems;
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "boundaries",
  since: "0.11.0",
  subject: "tree",
  baseline: false,
  retired: [],
  applies: (repo) =>
    sources(repo).length > 0 ? { on: true } : { on: false, because: "git tracks no JavaScript or TypeScript source" },
  async run(repo) {
    const byKey = Map.groupBy(await scan(repo), ({ file, specifier }) => `${file} imports ${specifier || "(parse)"}`);
    return [...byKey].map(([key, problems]) => ({ key, fix: [...new Set(problems.map(({ fix }) => fix))].join(" ") }));
  },
};
