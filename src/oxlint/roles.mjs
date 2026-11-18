import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

import { parseConfig } from "../config.mjs";
import { API_MODULES } from "../defaults.mjs";

export const DATA = ["pages", "live", "client-state", "unreachable"];
export const EFFECT = ["sync", "route", "subscribe"];
const VARIANTS = new Set(["browser", "server", "test", "spec", "stories"]);
const ROLE = /^(data|effect)-(.+)$/;

/** @param {string} file @returns {{ data: string[], effect: string[], cache: boolean, wrong: string[] }} */
export function parseName(file) {
  const [, ...parts] = posix.basename(file.split(sep).join("/")).split(".");
  parts.pop();
  /** @type {{ data: string[], effect: string[], cache: boolean, wrong: string[] }} */
  const name = { data: [], effect: [], cache: false, wrong: [] };
  let variant = false;
  for (const part of parts) {
    if (VARIANTS.has(part)) { variant = true; continue; }
    const match = ROLE.exec(part);
    if (!match && part !== "cache") continue;
    if (variant || match && !(match[1] === "data" ? DATA : EFFECT).includes(match[2]) || !match && !file.endsWith(".cache.ts")) { name.wrong.push(part); continue; }
    if (!match) name.cache = true;
    else name[/** @type {"data" | "effect"} */ (match[1])].push(match[2]);
  }
  return name;
}

/** @param {string} file @param {string} segment */
export function withSegment(file, segment) {
  const folder = posix.dirname(file);
  const [stem, ...parts] = posix.basename(file).split(".");
  const at = parts.findIndex((/** @type {string} */ part, /** @type {number} */ index) => VARIANTS.has(part) || index === parts.length - 1);
  return posix.join(folder, [stem, ...parts.slice(0, at), segment, ...parts.slice(at)].join("."));
}

/** @type {Map<string, { root: string, effects: Set<string>, data: Set<string>, apps: string[] } | null>} */
const legacy = new Map();
/** @type {Map<string, { root: string, globs: readonly string[] }>} */
const apis = new Map();

/** @param {string} filename @returns {{ root: string, globs: readonly string[] }} The API module globs and the folder they are relative to: a legacy config's api-modules during adoption, else the derived default. */
export function apiModules(filename) {
  for (let root = dirname(filename); ; root = dirname(root)) {
    const cached = apis.get(root);
    if (cached) return cached;
    const path = join(root, ".standard/config.json");
    const top = dirname(root) === root || existsSync(join(root, ".git"));
    if (existsSync(path) || top) {
      /** @type {readonly string[]} */
      let globs = API_MODULES;
      try {
        const config = existsSync(path) ? parseConfig(readFileSync(path, "utf8")) : undefined;
        if (config && config.allow === undefined) globs = config.apiModules;
      } catch {
        globs = API_MODULES;
      }
      const found = { root, globs };
      apis.set(root, found);
      return found;
    }
  }
}

/** @param {string} filename */
function legacyLists(filename) {
  for (let root = dirname(filename); ; root = dirname(root)) {
    if (legacy.has(root)) return legacy.get(root);
    const path = join(root, ".standard/config.json");
    if (existsSync(path)) {
      /** @type {{ root: string, effects: Set<string>, data: Set<string>, apps: string[] } | null} */
      let lists = null;
      try {
        const config = parseConfig(readFileSync(path, "utf8"));
        if (config.allow === undefined) lists = { root, effects: new Set(config.effectWrappers.map((entry) => entry.file)), data: new Set(config.clientData.flatMap((entry) => "file" in entry ? [entry.file] : [])), apps: config.clientData.flatMap((entry) => "app" in entry ? [entry.app] : []) };
      } catch {
        lists = null;
      }
      legacy.set(root, lists);
      return lists;
    }
    if (dirname(root) === root) { legacy.set(root, null); return null; }
  }
}

/** @param {string} filename @returns {{ data: boolean, effect: string[] }} The roles a file has from its name or, during adoption, from the legacy lists. */
export function rolesOf(filename) {
  const name = parseName(filename);
  const lists = legacyLists(filename);
  const path = lists ? relative(lists.root, filename).split(sep).join("/") : "";
  return {
    data: name.data.length > 0 || Boolean(lists && (lists.data.has(path) || lists.apps.some((/** @type {string} */ app) => path.startsWith(`${app}/`)))),
    effect: lists?.effects.has(path) ? [...name.effect, "listed"] : name.effect,
  };
}
