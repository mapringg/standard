import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PACKAGE = "@mapringg/standard";

export const REPOSITORY = "mapringg/standard";

/** @type {string} */
export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/**
 * @typedef {{ kind: "none" } | { kind: "unreadable" } | { kind: "pinned", spec: string, version: string | null }} Pin
 */

/**
 * @param {string} version
 * @returns {number[]}
 */
function parts(version) {
  return version.split(".").map(Number);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  const at = x.findIndex((part, index) => part !== y[index]);
  return at !== -1 && x[at] > y[at];
}

/**
 * @param {string | null} manifest
 * @returns {Pin}
 */
export function pinOf(manifest) {
  if (manifest === null) return { kind: "none" };
  let spec;
  try {
    const parsed = JSON.parse(manifest);
    spec = parsed.devDependencies?.[PACKAGE] ?? parsed.dependencies?.[PACKAGE];
  } catch {
    return { kind: "unreadable" };
  }
  if (typeof spec !== "string") return { kind: "none" };
  return { kind: "pinned", spec, version: /(\d+\.\d+\.\d+)/.exec(spec)?.[1] ?? null };
}

/**
 * @param {string} spec
 * @returns {boolean}
 */
export function isExact(spec) {
  return /^\d+\.\d+\.\d+$/.test(spec) || /#v?\d+\.\d+\.\d+$/.test(spec);
}

/**
 * @param {string} root
 * @returns {string | null}
 */
export function installedVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, "node_modules", PACKAGE, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}
