import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { posix } from "node:path";

import { ResolverFactory } from "oxc-resolver";

import { classicApi, majorOf, nativeApi, typescriptFor } from "./typescript.mjs";

/**
 * @typedef {"import" | "require"} Mode The resolution mode of one import site, which picks the import or require condition.
 * @typedef {(file: string, specifier: string, mode: Mode, viaPaths: boolean) => string | "builtin" | null} Resolve
 *   Resolves from an absolute file to an absolute real path. Without viaPaths it ignores tsconfig paths, as a package name resolves outside the project.
 * @typedef {{ moduleResolution: "node" | "bundler", resolve: Resolve }} Project
 */

const NODE_MODULES = new Set([100, 101, 102, 199]);
const NODE_RESOLUTION = new Set([3, 99]);
const CODE = /\.(?:[cm]?[jt]sx?|json)$/;

/** TypeScript's substitution: a .js specifier finds the .ts, .tsx or .d.ts that declares it before the .js itself. */
const EXTENSION_ALIAS = {
  ".js": [".ts", ".tsx", ".d.ts", ".js"],
  ".jsx": [".tsx", ".d.ts", ".jsx"],
  ".mjs": [".mts", ".d.mts", ".mjs"],
  ".cjs": [".cts", ".d.cts", ".cjs"],
};
const EXTENSIONS = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

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
 * The resolver a TypeScript 7 project, or a file outside any TypeScript project, uses. TypeScript 7 exposes no module
 * resolution, so this sets oxc-resolver from the project's own options: its moduleResolution, customConditions and paths.
 * @param {string | null} tsconfig Absolute path, or null for a file outside any TypeScript project, which runs on Node.
 * @param {Record<string, any>} options The effective compilerOptions.
 * @returns {Project}
 */
function oxcProject(tsconfig, options) {
  const node = tsconfig === null || NODE_RESOLUTION.has(options.moduleResolution ?? (NODE_MODULES.has(options.module) ? 99 : 100));
  /** @type {Map<string, ResolverFactory>} */
  const factories = new Map();
  /** @param {Mode} mode */
  const conditionsFor = (mode) => [...(tsconfig ? ["types"] : []), mode, ...(node ? ["node"] : []), ...(options.customConditions ?? [])];
  /**
   * @param {readonly string[]} conditions
   * @param {boolean} viaPaths
   */
  const factory = (conditions, viaPaths) => {
    const key = `${conditions.join(",")} ${viaPaths}`;
    if (!factories.has(key)) {
      factories.set(key, new ResolverFactory({
        ...(tsconfig && viaPaths ? { tsconfig: { configFile: tsconfig } } : {}),
        conditionNames: [...conditions, "default"],
        mainFields: tsconfig ? ["types", "typings", "main"] : ["main"],
        extensions: EXTENSIONS,
        extensionAlias: EXTENSION_ALIAS,
        builtinModules: true,
      }));
    }
    return /** @type {ResolverFactory} */ (factories.get(key));
  };
  return {
    moduleResolution: node ? "node" : "bundler",
    resolve(file, specifier, mode, viaPaths) {
      const conditions = conditionsFor(mode);
      const found = oxc(factory(conditions, viaPaths), file, specifier);
      if (found !== null || tsconfig === null || /^[./]/.test(specifier)) return found;
      // oxc-resolver stops at the first exports target that matches. TypeScript skips one whose file does not exist and tries the next.
      return fallThrough(file, specifier, new Set([...conditions, "default"]));
    },
  };
}

/**
 * @param {string} path Absolute.
 * @returns {Record<string, any> | null} Null when it is missing or unreadable, as for the resolver.
 */
function manifest(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} file Absolute.
 * @param {string} specifier A bare or # specifier.
 * @returns {{ dir: string, map: Record<string, unknown>, key: string } | null} The package whose exports, or the scope whose imports, the specifier names.
 */
function mappingOf(file, specifier) {
  const name = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
  let scoped = false;
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    const own = scoped ? null : manifest(posix.join(dir, "package.json"));
    if (own) {
      scoped = true;
      if (specifier.startsWith("#")) return own.imports ? { dir, map: own.imports, key: specifier } : null;
      if (own.name === name && own.exports !== undefined) return { dir, map: exportsMap(own.exports), key: `.${specifier.slice(name.length)}` };
    }
    const installed = posix.join(dir, "node_modules", name, "package.json");
    const dependency = specifier.startsWith("#") ? null : manifest(installed);
    if (dependency) return dependency.exports === undefined ? null : { dir: posix.dirname(realpathSync(installed)), map: exportsMap(dependency.exports), key: `.${specifier.slice(name.length)}` };
    if (dir === "/") return null;
  }
}

/**
 * @param {unknown} exports
 * @returns {Record<string, unknown>} Exports with the "." sugar expanded.
 */
function exportsMap(exports) {
  const subpaths = exports !== null && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some((key) => key.startsWith("."));
  return subpaths ? /** @type {Record<string, unknown>} */ (exports) : { ".": exports };
}

/**
 * @param {string} file
 * @param {string} specifier
 * @param {ReadonlySet<string>} conditions
 * @returns {string | null} The target TypeScript takes: the first, in the map's order, whose conditions all match and whose file exists.
 */
function fallThrough(file, specifier, conditions) {
  const mapping = mappingOf(file, specifier);
  if (mapping === null) return null;
  const { dir, map, key } = mapping;
  if (Object.hasOwn(map, key) && !key.includes("*")) return target(dir, map[key], "", conditions);
  let best = null;
  for (const pattern of Object.keys(map)) {
    const [prefix, suffix, extra] = pattern.split("*");
    if (suffix === undefined || extra !== undefined || !key.startsWith(prefix) || !key.endsWith(suffix) || key.length < pattern.length) continue;
    if (best === null || prefix.length > best.prefix.length || (prefix.length === best.prefix.length && pattern.length > best.pattern.length)) best = { pattern, prefix, suffix };
  }
  return best && target(dir, map[best.pattern], key.slice(best.prefix.length, key.length - best.suffix.length), conditions);
}

/**
 * @param {string} dir
 * @param {unknown} value
 * @param {string} star
 * @param {ReadonlySet<string>} conditions
 * @returns {string | null}
 */
function target(dir, value, star, conditions) {
  if (typeof value === "string") {
    if (!value.startsWith("./")) return null;
    const path = posix.join(dir, value.replaceAll("*", star));
    const alias = Object.entries(EXTENSION_ALIAS).find(([extension]) => path.endsWith(extension));
    const candidates = alias ? alias[1].map((extension) => path.slice(0, -alias[0].length) + extension) : [path];
    const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    return found ? realpathSync(found) : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = target(dir, item, star, conditions);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [condition, branch] of Object.entries(value)) {
    if (condition !== "default" && !conditions.has(condition)) continue;
    const found = target(dir, branch, star, conditions);
    if (found !== null) return found;
  }
  return null;
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
 * @param {string} root Absolute real path of the repository.
 * @param {readonly string[]} tsconfigs Repo paths of the tracked tsconfig.json files.
 * @returns {Promise<{ of(file: string): Project, node: Project }>} The project of a repo file, the one its nearest tsconfig.json opens, and the resolver Node itself uses, as for a require that createRequire makes.
 */
export async function projects(root, tsconfigs) {
  /** @type {Map<string | null, Project>} */
  const byConfig = new Map([[null, oxcProject(null, {})]]);
  /** @type {Map<string, string[]>} */
  const byInstall = new Map();
  for (const path of tsconfigs) {
    const absolute = posix.join(root, path);
    const install = typescriptFor(absolute);
    if (install === null) byConfig.set(path, oxcProject(absolute, {}));
    else byInstall.set(install, [...(byInstall.get(install) ?? []), path]);
  }
  for (const [install, paths] of byInstall) {
    if (majorOf(install) >= 7) {
      const API = await nativeApi(install);
      const api = new API({});
      try {
        for (const path of paths) byConfig.set(path, oxcProject(posix.join(root, path), api.parseConfigFile(posix.join(root, path)).options));
      } finally {
        api.close();
      }
    } else {
      const ts = classicApi(install);
      for (const path of paths) {
        const parsed = ts.getParsedCommandLineOfConfigFile(posix.join(root, path), undefined, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
        byConfig.set(path, parsed ? classicProject(ts, parsed.options) : oxcProject(posix.join(root, path), {}));
      }
    }
  }
  const owned = new Set(tsconfigs);
  const node = /** @type {Project} */ (byConfig.get(null));
  return {
    node,
    of(file) {
      for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
        const config = posix.join(dir, "tsconfig.json");
        if (owned.has(config)) return /** @type {Project} */ (byConfig.get(config));
        if (dir === ".") return node;
      }
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
