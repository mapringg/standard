import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {string} tsconfig Absolute path.
 * @returns {string | null} The folder of the typescript package that tsconfig's folder resolves, or null when it has none.
 */
export function typescriptFor(tsconfig) {
  try {
    return posix.dirname(realpathSync(createRequire(tsconfig).resolve("typescript/package.json")));
  } catch {
    return null;
  }
}

/**
 * @param {string} install The folder of a typescript package.
 * @returns {number} Its major version.
 */
export function majorOf(install) {
  return Number.parseInt(JSON.parse(readFileSync(posix.join(install, "package.json"), "utf8")).version, 10);
}

/**
 * @param {string} install The folder of a typescript package before 7.
 * @returns {any} Its compiler API.
 */
export function classicApi(install) {
  return createRequire(posix.join(install, "package.json"))("./lib/typescript.js");
}

/**
 * @param {string} install The folder of a typescript 7 package.
 * @returns {Promise<any>} Its native sync API class.
 */
export async function nativeApi(install) {
  const { API } = await import(pathToFileURL(posix.join(install, "dist/api/sync/api.js")).href);
  return API;
}
