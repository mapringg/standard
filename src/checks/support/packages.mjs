import { posix } from "node:path";

export const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
export const NOT_PRODUCT = /\.(?:test|spec|stories)\.[^/]+$|(?:^|\/)(?:__tests__|tests?|__fixtures__|fixtures?)\//;

/**
 * @param {ReadonlySet<string>} manifests Tracked package.json paths.
 * @param {string} path
 * @returns {string | null} The folder of the nearest manifest above path, "." for the root.
 */
export function packageOf(manifests, path) {
  for (let folder = posix.dirname(path); ; folder = posix.dirname(folder)) {
    if (manifests.has(posix.join(folder, "package.json"))) return folder;
    if (folder === ".") return null;
  }
}

/**
 * @param {Pick<import("../../repo.mjs").Repo, "files" | "read">} repo
 * @param {string} name
 * @returns {string[]} The folders whose tracked package.json depends on the package.
 */
export function dependents(repo, name) {
  return repo.files("**/package.json").filter((path) => {
    try {
      const manifest = JSON.parse(repo.read(path));
      return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some((deps) => deps?.[name] !== undefined);
    } catch {
      return false;
    }
  }).map(posix.dirname);
}

/**
 * @param {Pick<import("../../repo.mjs").Repo, "files" | "read">} repo
 * @returns {string[]} The React apps: folders whose tracked package.json declares react and a bundler, next or vite. A library such as a UI package declares neither.
 */
export function reactApps(repo) {
  const bundled = new Set([...dependents(repo, "next"), ...dependents(repo, "vite")]);
  return dependents(repo, "react").filter((folder) => bundled.has(folder));
}

/**
 * @param {import("../../repo.mjs").Repo} repo
 * @returns {Set<string>} Each React app's copies of the package templates, which repeat by design.
 */
export function templateCopies(repo) {
  return new Set(reactApps(repo).flatMap((app) => ["src/lib/swr.ts", "src/lib/timer.ts"].map((file) => posix.join(app, file))));
}
