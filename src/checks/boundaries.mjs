import { existsSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseSync } from "oxc-parser";

import { projects, resolveAsset } from "./support/resolve.mjs";

/**
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {import("../config.mjs").Boundaries} Boundaries
 * @typedef {import("../config.mjs").ModuleRule} ModuleRule
 * @typedef {import("./support/resolve.mjs").Mode} Mode
 *
 * @typedef {object} Workspace A folder with a tracked package.json, "." for the root.
 * @property {string} dir
 * @property {string | null} name
 * @property {boolean} exports Whether its package.json has an exports field.
 * @property {boolean} module Whether its package.json sets "type": "module".
 * @property {ReadonlySet<string>} declares Package names its dependency lists name, with @types/ stripped.
 *
 * @typedef {import("./support/resolve.mjs").Kind} Kind
 * @typedef {{ specifier: string, kind: Kind, base?: string }} Request `base` is the absolute file a createRequire require resolves from.
 *
 * @typedef {object} Edge An import whose target is a repo file.
 * @property {string} file
 * @property {string} specifier
 * @property {string} target
 * @property {() => string | null} unaliased The repo file the specifier resolves to without tsconfig paths, as a package name resolves outside the project.
 *
 * @typedef {{ file: string, specifier: string, rule: string, fix: string }} Problem
 * @typedef {{ workspaces: readonly Workspace[], boundaries: Boundaries }} Context
 * @typedef {{ name: string, check(edge: Edge, context: Context): string | null }} Rule
 */

const SOURCE = /\.[cm]?[jt]sx?$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DEPENDENCIES = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/**
 * @param {string} path
 * @param {readonly string[]} globs
 * @returns {boolean}
 */
function matches(path, globs) {
  return globs.some((glob) => posix.matchesGlob(path, glob));
}

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

/**
 * @param {readonly ModuleRule[]} modules
 * @param {string} path
 * @returns {{ dir: string, rule: ModuleRule, open: boolean } | null} The innermost module that holds the path.
 */
function moduleOf(modules, path) {
  for (const dir of folders(path)) {
    for (const rule of modules) {
      if (matches(dir, rule.open)) return { dir, rule, open: true };
      if (matches(dir, rule.folders)) return { dir, rule, open: false };
    }
  }
  return null;
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
  {
    name: "modules",
    check({ file, target }, { workspaces, boundaries }) {
      if (workspaceOf(workspaces, target) !== workspaceOf(workspaces, file)) return null;
      const owner = moduleOf(boundaries.modules, target);
      if (owner === null || owner.open || matches(file, owner.rule.except)) return null;
      if (moduleOf(boundaries.modules, file)?.dir === owner.dir) return null;
      const name = posix.basename(target, posix.extname(target));
      if (posix.dirname(target) === owner.dir && owner.rule.entries.includes(name)) return null;
      const entries = owner.rule.entries.map((entry) => `${owner.dir}/${entry}`).join(" or ");
      return `${target} is inside the module ${owner.dir}. Import it through ${entries}, and export what you need there.`;
    },
  },
  {
    name: "forbid",
    check({ file, target }, { boundaries }) {
      const rule = boundaries.forbid.find(
        (rule) => matches(file, rule.files) && !matches(file, rule.except) && matches(target, rule.imports),
      );
      return rule ? `${target} matches boundaries.forbid ${JSON.stringify(rule.imports.join(", "))}. ${rule.fix}` : null;
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
 * @returns {boolean}
 */
function isImportMetaUrl(node) {
  return node?.type === "MemberExpression" && node.object.type === "MetaProperty" && node.object.meta.name === "import" && node.property.name === "url";
}

/**
 * @param {any} node The argument of createRequire.
 * @param {string} file Absolute path of the file that calls it.
 * @returns {string | null} The absolute file the require resolves from, or null when the argument is computed.
 */
function baseOf(node, file) {
  if (isImportMetaUrl(node) || (node?.type === "Identifier" && node.name === "__filename")) return file;
  const text = literal(node);
  if (text !== null) {
    if (text.startsWith("file:")) return fileURLToPath(text);
    return posix.isAbsolute(text) ? text : null;
  }
  if (node?.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "URL" && node.arguments.length === 2 && isImportMetaUrl(node.arguments[1])) {
    const relative = literal(node.arguments[0]);
    return relative === null ? null : fileURLToPath(new URL(relative, pathToFileURL(file)));
  }
  return null;
}

/**
 * @typedef {{ kind: "creator" | "namespace" | "other" } | { kind: "require", base: string | null }} Binding What a name means in a scope: the
 *   createRequire import, a namespace of node:module, a require that createRequire made from base, or anything else.
 * @typedef {{ parent: Scope | null, names: Map<string, Binding>, opaque?: boolean }} Scope A with statement's body is opaque: any name in it may come from its object.
 */

const OTHER = /** @type {Binding} */ ({ kind: "other" });
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement"]);

/**
 * @param {Scope} scope
 * @param {string} name
 * @returns {Scope | null} The nearest scope that binds the name, or may, or null for a global.
 */
function ownerOf(scope, name) {
  for (let at = /** @type {Scope | null} */ (scope); at; at = at.parent) if (at.names.has(name) || at.opaque) return at;
  return null;
}

/**
 * @param {any} pattern
 * @returns {string[]} The names a binding pattern declares.
 */
function namesOf(pattern) {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((/** @type {any} */ property) => namesOf(property.type === "RestElement" ? property.argument : property.value));
    case "ArrayPattern":
      return pattern.elements.flatMap(namesOf);
    case "AssignmentPattern":
      return namesOf(pattern.left);
    case "RestElement":
      return namesOf(pattern.argument);
    case "TSParameterProperty":
      return namesOf(pattern.parameter);
    default:
      return [];
  }
}

/**
 * @param {Scope} scope
 * @param {readonly any[]} statements
 * Binds what the statements declare in their block: let, const, class, function and imports. A declare-only statement binds nothing at runtime.
 */
function declareBlock(scope, statements) {
  for (const outer of statements) {
    const statement = outer.type.startsWith("Export") && outer.declaration ? outer.declaration : outer;
    if (statement.declare) continue;
    if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
      for (const { id } of statement.declarations) for (const name of namesOf(id)) scope.names.set(name, OTHER);
    } else if (["FunctionDeclaration", "ClassDeclaration", "TSEnumDeclaration", "TSImportEqualsDeclaration"].includes(statement.type) && statement.id) {
      scope.names.set(statement.id.name, OTHER);
    } else if (statement.type === "ImportDeclaration") {
      const module = ["module", "node:module"].includes(statement.source.value);
      for (const specifier of statement.specifiers) {
        const creator = specifier.type === "ImportSpecifier" && (specifier.imported.name ?? specifier.imported.value) === "createRequire";
        const kind = !module || statement.importKind === "type" ? "other" : creator ? "creator" : specifier.type === "ImportSpecifier" ? "other" : "namespace";
        scope.names.set(specifier.local.name, { kind });
      }
    }
  }
}

/**
 * @param {Scope} scope
 * @param {unknown} node
 * Binds every var under the node, up to a nested function, in the function's scope.
 */
function declareVars(scope, node) {
  if (Array.isArray(node)) return node.forEach((item) => declareVars(scope, item));
  if (node === null || typeof node !== "object") return;
  const any = /** @type {any} */ (node);
  if (FUNCTIONS.has(any.type)) return;
  if (any.type === "VariableDeclaration" && any.kind === "var" && !any.declare) for (const { id } of any.declarations) for (const name of namesOf(id)) scope.names.set(name, OTHER);
  for (const [key, value] of Object.entries(any)) if (key !== "loc" && key !== "range" && typeof value === "object") declareVars(scope, value);
}

/**
 * @param {any} node
 * @returns {Request | null} An import declaration, export from, import() or import x = require().
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
    default:
      return null;
  }
}

/**
 * @param {any} program
 * @param {string} file Absolute.
 * @returns {Request[]} Every import with a fixed specifier. A require() call reads its callee's nearest binding: the global require,
 *   or a const that createRequire, imported or a const of node:module, made from a fixed anchor. Any other loader is skipped. The calls wait for the whole walk, so a function may use a require declared below it.
 */
function requestsOf(program, file) {
  /** @type {Request[]} */
  const requests = [];
  /** @type {{ node: any, scope: Scope }[]} */
  const calls = [];
  /**
   * @param {Scope | null} parent
   * @returns {Scope}
   */
  const open = (parent) => ({ parent, names: new Map() });
  /** @param {any} callee @param {Scope} scope */
  const creates = (callee, scope) => {
    if (callee.type === "Identifier") return ownerOf(scope, callee.name)?.names.get(callee.name)?.kind === "creator";
    if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier" || callee.property.name !== "createRequire") return false;
    return ownerOf(scope, callee.object.name)?.names.get(callee.object.name)?.kind === "namespace";
  };
  /** @param {unknown} node @param {Scope} scope */
  const children = (node, scope) => {
    for (const [key, value] of Object.entries(/** @type {object} */ (node))) if (key !== "loc" && key !== "range" && typeof value === "object") visit(value, scope);
  };
  /** @param {unknown} node @param {Scope} scope */
  const visit = (node, scope) => {
    if (Array.isArray(node)) return node.forEach((item) => visit(item, scope));
    if (node === null || typeof node !== "object") return;
    const any = /** @type {any} */ (node);
    if (FUNCTIONS.has(any.type)) {
      const params = open(scope);
      if (any.type === "FunctionExpression" && any.id) params.names.set(any.id.name, OTHER);
      for (const param of any.params) for (const name of namesOf(param)) params.names.set(name, OTHER);
      visit(any.params, params);
      if (any.body?.type !== "BlockStatement") return visit(any.body, params);
      const body = open(params);
      declareVars(body, any.body.body);
      declareBlock(body, any.body.body);
      visit(any.body.body, body);
      return;
    }
    if (any.type === "BlockStatement" || any.type === "StaticBlock" || any.type === "SwitchStatement") {
      const inner = open(scope);
      const statements = any.type === "SwitchStatement" ? any.cases.flatMap((/** @type {any} */ each) => each.consequent) : any.body;
      if (any.type === "StaticBlock") declareVars(inner, statements);
      declareBlock(inner, statements);
      if (any.type === "SwitchStatement") visit(any.discriminant, scope);
      visit(any.type === "SwitchStatement" ? any.cases : any.body, inner);
      return;
    }
    if (any.type === "CatchClause" || LOOPS.has(any.type) || (any.type === "ClassExpression" && any.id)) {
      const inner = open(scope);
      const head = any.init ?? any.left;
      const loop = head?.type === "VariableDeclaration" && head.kind !== "var" ? head.declarations.map((/** @type {any} */ { id }) => id) : [];
      for (const name of (any.type === "CatchClause" ? [any.param] : any.type === "ClassExpression" ? [any.id] : loop).flatMap(namesOf)) inner.names.set(name, OTHER);
      children(any, inner);
      return;
    }
    if (any.type === "WithStatement") {
      visit(any.object, scope);
      visit(any.body, { parent: scope, names: new Map(), opaque: true });
      return;
    }
    if (any.type === "VariableDeclaration" && any.kind === "const") {
      for (const { id, init } of any.declarations) {
        const owner = id.type === "Identifier" && init?.type === "CallExpression" ? ownerOf(scope, id.name) : null;
        if (owner === null) continue;
        if (creates(init.callee, scope)) owner.names.set(id.name, { kind: "require", base: baseOf(init.arguments[0], file) });
        else if (init.callee.type === "Identifier" && init.callee.name === "require" && ownerOf(scope, "require") === null && ["module", "node:module"].includes(literal(init.arguments[0]) ?? "")) owner.names.set(id.name, { kind: "namespace" });
      }
    }
    if (any.type === "CallExpression" && any.callee.type === "Identifier" && any.arguments.length === 1) calls.push({ node: any, scope });
    const request = requestOf(any);
    if (request) requests.push(request);
    children(any, scope);
  };
  const root = open(null);
  declareVars(root, program.body);
  declareBlock(root, program.body);
  visit(program.body, root);
  for (const { node, scope } of calls) {
    const specifier = literal(node.arguments[0]);
    if (specifier === null) continue;
    const owner = ownerOf(scope, node.callee.name);
    const binding = owner ? owner.names.get(node.callee.name) ?? OTHER : undefined;
    if (binding === undefined && node.callee.name === "require") requests.push({ specifier, kind: "require" });
    else if (binding?.kind === "require" && binding.base) requests.push({ specifier, kind: "require", base: binding.base });
  }
  return requests;
}

/**
 * @param {string} file
 * @param {string} text
 * @param {string} absolute
 * @returns {{ requests: Request[] } | { error: string }} Every import with a fixed specifier. An import() or require() of a computed value has none, as for TypeScript, and neither has a require that createRequire makes from a computed path.
 */
function importsOf(file, text, absolute) {
  const { errors, program } = parseSync(file, text);
  if (errors.length > 0) return { error: errors[0].message };
  /** @type {Map<string, Request>} */
  const requests = new Map();
  for (const request of requestsOf(program, absolute)) requests.set(`${request.kind} ${request.base ?? ""} ${request.specifier}`, request);
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
  const files = sources(repo);
  const resolvers = await projects(root, repo.files("**/tsconfig.json").filter((path) => !path.split("/").includes("node_modules")), files);
  const context = { workspaces: workspacesOf(repo), boundaries: repo.config.boundaries };
  const workspaceNames = new Set(context.workspaces.flatMap(({ name }) => (name ? [name] : [])));
  const inRepo = (/** @type {string | null} */ path) => {
    if (path === null) return null;
    const relative = posix.relative(root, path);
    return relative.startsWith("../") || relative.split("/").includes("node_modules") ? null : relative;
  };
  /**
   * @param {string} origin Absolute.
   * @param {string} name
   * @returns {boolean} Whether the node_modules folder the name resolves through links to a folder of this repository, as a workspace package or an alias of one does.
   */
  const installedInRepo = (origin, name) => {
    for (let dir = posix.dirname(origin); dir.startsWith(root); dir = posix.dirname(dir)) {
      const folder = posix.join(dir, "node_modules", name);
      if (existsSync(folder)) return inRepo(realpathSync(folder)) !== null;
      if (dir === root) break;
    }
    return false;
  };
  /** @type {Problem[]} */
  const problems = [];
  for (const file of files) {
    const absolute = posix.join(root, file);
    const found = importsOf(file, repo.read(file), absolute);
    if ("error" in found) {
      problems.push({ file, specifier: "", rule: "parse", fix: `${file} does not parse, so its imports cannot be checked: ${found.error} Fix the syntax.` });
      continue;
    }
    for (const { specifier, kind, base } of found.requests) {
      if (SCHEME.test(specifier)) continue;
      const origin = base ?? absolute;
      const project = base ? resolvers.node : resolvers.of(file);
      const from = workspaceOf(context.workspaces, inRepo(base ?? null) ?? file);
      const mode = modeOf(file, kind, from, project.moduleResolution);
      const resolved = project.resolve(origin, specifier, mode, true, kind) ?? resolveAsset(origin, specifier, true);
      if (resolved === "builtin") continue;
      if (resolved !== null) {
        const target = inRepo(resolved);
        if (target === null) continue;
        const unaliased = () => {
          const path = project.resolve(origin, specifier, mode, false, kind) ?? resolveAsset(origin, specifier, false);
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
      const workspace = bare && (workspaceNames.has(name) || installedInRepo(origin, name));
      const declared = from.declares.has(name) || workspaceOf(context.workspaces, ".").declares.has(name);
      if (bare && !workspace && declared) continue;
      const manifest = posix.join(from.dir, "package.json");
      const fix = !bare
        ? `"${specifier}" in ${file} does not resolve. Fix the path so it names a file.`
        : workspace
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
  retired: [
    "packages/oxlint-plugin-*/rules/module-boundaries.ts",
    "packages/oxlint-plugin-*/rules/module-boundaries.test.ts",
    "packages/oxlint-plugin-*/rules/no-restricted-import-paths.ts",
    "packages/oxlint-plugin-*/rules/no-restricted-import-paths.test.ts",
  ],
  applies: (repo) =>
    sources(repo).length > 0 ? { on: true } : { on: false, because: "git tracks no JavaScript or TypeScript source" },
  async run(repo) {
    const byKey = Map.groupBy(await scan(repo), ({ file, specifier }) => `${file} imports ${specifier || "(parse)"}`);
    return [...byKey].map(([key, problems]) => ({ key, fix: [...new Set(problems.map(({ fix }) => fix))].join(" ") }));
  },
};
