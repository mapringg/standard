import { posix } from "node:path";

export const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;

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
