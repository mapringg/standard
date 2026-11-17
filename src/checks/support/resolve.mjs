import { existsSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

import { ResolverFactory } from "oxc-resolver";

import { classicApi, majorOf, nativeApi, typescriptFor } from "./typescript.mjs";

/**
 * @typedef {"import" | "require"} Mode The resolution mode of one import site, which picks the import or require condition.
 * @typedef {"static" | "dynamic" | "require"} Kind How the file imports: a declaration, an import(), or require() and import x = require().
 * @typedef {(file: string, specifier: string, mode: Mode, viaPaths: boolean, kind: Kind) => string | "builtin" | null} Resolve
 *   Resolves from an absolute file to an absolute real path. Without viaPaths it ignores tsconfig paths, as a package name resolves outside the project.
 * @typedef {{ moduleResolution: "node" | "bundler", resolve: Resolve }} Project
 */

const NODE_MODULES = new Set([100, 101, 102, 199]);
const NODE_RESOLUTION = new Set([3, 99]);
const CODE = /\.(?:[cm]?[jt]sx?|json)$/;
const SCRIPT = /\.[cm]?jsx?$/;

/**
 * @param {ResolverFactory} factory
 * @param {string} file
 * @param {string} specifier
 * @returns {string | "builtin" | null}
 */
function oxc(factory, file, specifier) {
  const result = factory.resolveFileSync(file, specifier);
  if (result.builtin) return "builtin";
  return result.path ?? null;
}

/**
 * How Node resolves a file outside any TypeScript project, a createRequire call, and a require() that TypeScript does not read.
 * @returns {Project}
 */
function nodeProject() {
  /** @param {Mode} mode */
  const factory = (mode) =>
    new ResolverFactory({
      conditionNames: [mode, "node", "default"],
      mainFields: ["main"],
      extensions: [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"],
      extensionAlias: { ".js": [".ts", ".tsx", ".d.ts", ".js"], ".jsx": [".tsx", ".d.ts", ".jsx"], ".mjs": [".mts", ".d.mts", ".mjs"], ".cjs": [".cts", ".d.cts", ".cjs"] },
      builtinModules: true,
    });
  const byMode = { import: factory("import"), require: factory("require") };
  return { moduleResolution: "node", resolve: (file, specifier, mode) => oxc(byMode[mode], file, specifier) };
}

/**
 * The resolver a project on TypeScript before 7 uses: the compiler's own resolveModuleName with the project's options.
 * @param {any} ts
 * @param {Record<string, any>} options
 * @returns {Project}
 */
function classicProject(ts, options) {
  const { paths, baseUrl, ...withoutPaths } = options;
  const caches = [true, false].map((viaPaths) => ts.createModuleResolutionCache(process.cwd(), (/** @type {string} */ name) => name, viaPaths ? options : withoutPaths));
  const node = NODE_RESOLUTION.has(ts.getEmitModuleResolutionKind(options));
  return {
    moduleResolution: node ? "node" : "bundler",
    resolve(file, specifier, mode, viaPaths) {
      if (isBuiltin(specifier)) return "builtin";
      const kind = mode === "import" ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS;
      const resolved = ts.resolveModuleName(specifier, file, viaPaths ? options : withoutPaths, ts.sys, caches[viaPaths ? 0 : 1], undefined, kind).resolvedModule;
      return resolved && existsSync(resolved.resolvedFileName) ? realpathSync(resolved.resolvedFileName) : null;
    },
  };
}

/**
 * TypeScript 7 exposes no resolveModuleName, so the check asks its checker for the module each import names. It opens, for each
 * project, two virtual configs that extend it, list every file the project owns, and allow JavaScript: one as is and one without paths.
 * @param {string} install
 * @param {string} root
 * @param {ReadonlyMap<string, string[]>} owned Each tsconfig's absolute path, to the absolute files it owns.
 * @param {Project} node
 * @returns {Promise<Map<string, Project>>}
 */
async function nativeProjects(install, root, owned, node) {
  const API = await nativeApi(install);
  const { SyntaxKind } = await import(pathToFileURL(posix.join(install, "dist/ast/index.js")).href);
  /** @type {Map<string, string>} */
  const virtual = new Map();
  const configs = [...owned].map(([tsconfig, files], index) => {
    const variants = [true, false].map((viaPaths) => {
      const path = posix.join(posix.dirname(tsconfig), `.standard-boundaries-${index}-${viaPaths ? "paths" : "plain"}.json`);
      const compilerOptions = { allowJs: true, noEmit: true, ...(viaPaths ? {} : { paths: {} }) };
      virtual.set(path, JSON.stringify({ extends: `./${posix.basename(tsconfig)}`, compilerOptions, files, include: [] }));
      return path;
    });
    return { tsconfig, files, variants };
  });
  const api = new API({ cwd: root, fs: { readFile: (/** @type {string} */ path) => virtual.get(path), fileExists: (/** @type {string} */ path) => (virtual.has(path) ? true : undefined) } });
  /** @type {Map<string, Project>} */
  const found = new Map();
  try {
    const snapshot = api.updateSnapshot({ openProjects: [...virtual.keys()] });
    for (const { tsconfig, files, variants } of configs) {
      const options = api.parseConfigFile(tsconfig).options;
      const tables = variants.map((path) => modulesOf(snapshot.getProject(path), files, SyntaxKind));
      const moduleResolution = NODE_RESOLUTION.has(options.moduleResolution ?? (NODE_MODULES.has(options.module) ? 99 : 100)) ? "node" : "bundler";
      found.set(tsconfig, {
        moduleResolution,
        resolve(file, specifier, mode, viaPaths, kind) {
          if (isBuiltin(specifier)) return "builtin";
          const target = tables[viaPaths ? 0 : 1].get(file)?.get(`${kind} ${specifier}`);
          return target === undefined ? node.resolve(file, specifier, mode, viaPaths, kind) : target;
        },
      });
    }
  } finally {
    api.close();
  }
  return found;
}

/**
 * @param {any} project
 * @param {readonly string[]} files
 * @param {any} SyntaxKind
 * @returns {Map<string, Map<string, string | null>>} Each file's imports, keyed by kind and specifier, to the file TypeScript resolves,
 *   or null when it resolves none. A require() in a TypeScript file is absent, as TypeScript does not read it.
 */
function modulesOf(project, files, SyntaxKind) {
  const string = (/** @type {any} */ node) => node?.kind === SyntaxKind.StringLiteral || node?.kind === SyntaxKind.NoSubstitutionTemplateLiteral;
  /** @type {Map<string, Map<string, string | null>>} */
  const tables = new Map();
  for (const file of files) {
    const source = project?.program.getSourceFile(file);
    if (!source) continue;
    /** @type {[string, any][]} */
    const sites = [];
    const visit = (/** @type {any} */ node) => {
      if ((node.kind === SyntaxKind.ImportDeclaration || node.kind === SyntaxKind.ExportDeclaration) && string(node.moduleSpecifier)) sites.push(["static", node.moduleSpecifier]);
      if (node.kind === SyntaxKind.ExternalModuleReference && string(node.expression)) sites.push(["require", node.expression]);
      if (node.kind === SyntaxKind.CallExpression && node.arguments.length >= 1 && string(node.arguments[0])) {
        if (node.expression.kind === SyntaxKind.ImportKeyword) sites.push(["dynamic", node.arguments[0]]);
        else if (SCRIPT.test(file) && node.expression.kind === SyntaxKind.Identifier && node.expression.text === "require") sites.push(["require", node.arguments[0]]);
      }
      node.forEachChild(visit);
    };
    visit(source);
    const symbols = sites.length > 0 ? project.checker.getSymbolAtLocation(sites.map(([, node]) => node)) : [];
    tables.set(file, new Map(sites.map(([kind, node], index) => {
      const declaration = symbols[index]?.declarations.find((/** @type {any} */ each) => each.kind === SyntaxKind.SourceFile);
      return [`${kind} ${node.text}`, declaration ? realpathSync(declaration.path) : null];
    })));
  }
  return tables;
}

/**
 * @param {string} root Absolute real path of the repository.
 * @param {readonly string[]} tsconfigs Repo paths of the tracked tsconfig.json files.
 * @param {readonly string[]} sources Repo paths of the source files to check.
 * @returns {Promise<{ of(file: string): Project, node: Project }>} The project of a repo file: the one its nearest tsconfig.json opens.
 */
export async function projects(root, tsconfigs, sources) {
  const node = nodeProject();
  const owned = new Set(tsconfigs);
  /** @param {string} file */
  const configOf = (file) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      const config = posix.join(dir, "tsconfig.json");
      if (owned.has(config)) return config;
      if (dir === ".") return null;
    }
  };
  /** @type {Map<string, Project>} */
  const byConfig = new Map();
  /** @type {Map<string, Map<string, string[]>>} */
  const native = new Map();
  for (const path of tsconfigs) {
    const absolute = posix.join(root, path);
    const install = typescriptFor(absolute);
    if (install !== null && majorOf(install) >= 7) {
      const files = sources.filter((file) => configOf(file) === path).map((file) => posix.join(root, file));
      native.set(install, (native.get(install) ?? new Map()).set(absolute, files));
    } else if (install !== null) {
      const ts = classicApi(install);
      const parsed = ts.getParsedCommandLineOfConfigFile(absolute, undefined, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
      if (parsed) byConfig.set(path, classicProject(ts, parsed.options));
    }
  }
  for (const [install, configs] of native) {
    for (const [absolute, project] of await nativeProjects(install, root, configs, node)) byConfig.set(posix.relative(root, absolute), project);
  }
  return {
    node,
    of(file) {
      const config = configOf(file);
      return (config === null ? undefined : byConfig.get(config)) ?? node;
    },
  };
}

/** Find an asset such as a stylesheet, which TypeScript does not resolve but a bundler does, with and without the nearest tsconfig's paths. */
const ASSETS = [new ResolverFactory({ tsconfig: "auto", extensions: [], builtinModules: true }), new ResolverFactory({ extensions: [], builtinModules: true })];

/**
 * @param {string} file Absolute.
 * @param {string} specifier
 * @param {boolean} viaPaths
 * @returns {string | null}
 */
export function resolveAsset(file, specifier, viaPaths) {
  const extension = posix.extname(specifier.split("?")[0]);
  if (extension === "" || CODE.test(extension)) return null;
  const found = oxc(ASSETS[viaPaths ? 0 : 1], file, specifier);
  return found === "builtin" ? null : found;
}
