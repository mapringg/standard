import { existsSync, realpathSync } from "node:fs";
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
  /**
   * @param {Mode} mode
   * @param {boolean} viaPaths
   */
  const factory = (mode, viaPaths) => {
    const key = `${mode} ${viaPaths}`;
    if (!factories.has(key)) {
      factories.set(key, new ResolverFactory({
        ...(tsconfig && viaPaths ? { tsconfig: { configFile: tsconfig } } : {}),
        conditionNames: [...(tsconfig ? ["types"] : []), mode, ...(node ? ["node"] : []), ...(options.customConditions ?? []), "default"],
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
    resolve: (file, specifier, mode, viaPaths) => oxc(factory(mode, viaPaths), file, specifier),
  };
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
 * @returns {Promise<(file: string) => Project>} The project of a repo file: the one its nearest tsconfig.json opens.
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
  return (file) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      const config = posix.join(dir, "tsconfig.json");
      if (owned.has(config)) return /** @type {Project} */ (byConfig.get(config));
      if (dir === ".") return /** @type {Project} */ (byConfig.get(null));
    }
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
