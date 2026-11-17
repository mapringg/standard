import { realpathSync } from "node:fs";
import { posix } from "node:path";

import { projects } from "./resolve.mjs";
import { sourceFiles } from "./sources.mjs";

/**
 * @typedef {import("../../repo.mjs").Repo} Repo
 * @typedef {import("./source.mjs").Parsed} Parsed
 * @typedef {(file: string, specifier: string) => string | null} Target
 */

/** @type {(path: string) => string} The module a use path names: `@/api/users` for `@/api/users#getUser`. A subpath import such as `#api` keeps its leading `#`. */
export const moduleOf = (path) => (path.indexOf("#", 1) === -1 ? path : path.slice(0, path.indexOf("#", 1)));

/**
 * @param {Repo} repo
 * @returns {Promise<Target>} The file a file's specifier names, relative to the root, or null. Only source files are ever reached, so a target
 *   in node_modules or outside the repo matches nothing.
 */
export async function targets(repo) {
  const root = realpathSync(repo.root);
  const resolvers = await projects(root, repo.files("**/tsconfig.json").filter((path) => !path.split("/").includes("node_modules")), sourceFiles(repo));
  /** @type {Map<string, string | null>} */
  const resolved = new Map();
  /** @type {Target} */
  const resolve = (file, specifier) => {
    const resolver = resolvers.of(file);
    const found = resolver.resolve(posix.join(root, file), specifier, "import", true, "static") ?? resolver.resolve(posix.join(root, file), specifier, "import", true, "dynamic");
    return found === null || found === "builtin" ? null : posix.relative(root, found);
  };
  return (file, specifier) => {
    const at = `${file}\0${specifier}`;
    if (!resolved.has(at)) resolved.set(at, resolve(file, specifier));
    return resolved.get(at) ?? null;
  };
}

/** @type {(files: readonly Parsed[], target: Target) => Map<string, (string | null)[]>} Each file to the files it re-exports from. */
export const reExports = (files, target) =>
  new Map(files.map((file) => [file.path, [...new Set(file.exports.filter((item) => item.space === "module").map((item) => moduleOf(item.path)))].map((specifier) => target(file.path, specifier))]));

/** @type {(edges: ReadonlyMap<string, readonly (string | null)[]>, seeds: ReadonlyMap<string, string>) => Map<string, string>} Each file that reaches a seed along the edges, at any depth, to what that seed holds. */
export function reach(edges, seeds) {
  const reached = new Map(seeds);
  for (let grew = true; grew;) {
    grew = false;
    for (const [path, to] of edges) {
      const hit = reached.has(path) ? undefined : to.find((next) => next !== null && reached.has(next));
      if (hit) {
        reached.set(path, /** @type {string} */ (reached.get(hit)));
        grew = true;
      }
    }
  }
  return reached;
}
