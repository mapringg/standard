import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

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
    if (variant || match && !(match[1] === "data" ? DATA : EFFECT).includes(match[2])) { name.wrong.push(part); continue; }
    if (!match) name.cache = true;
    else name[/** @type {"data" | "effect"} */ (match[1])].push(match[2]);
  }
  return name;
}

/** @param {string} file @param {string} segment */
export function withSegment(file, segment) {
  const folder = posix.dirname(file);
  const [stem, ...parts] = posix.basename(file).split(".");
  const at = parts.findIndex((part, index) => VARIANTS.has(part) || index === parts.length - 1);
  return posix.join(folder, [stem, ...parts.slice(0, at), segment, ...parts.slice(at)].join("."));
}

/** @type {Map<string, { root: string, effects: Set<string>, data: Set<string>, apps: string[] } | null>} */
const legacy = new Map();

/** @param {string} filename */
function legacyLists(filename) {
  for (let root = dirname(filename); ; root = dirname(root)) {
    if (legacy.has(root)) return legacy.get(root);
    const path = join(root, ".standard/config.json");
    if (existsSync(path)) {
      const config = JSON.parse(readFileSync(path, "utf8"));
      const data = config["client-data"] ?? [];
      const lists = { root, effects: new Set((config["effect-wrappers"] ?? []).map((/** @type {{ file: string }} */ entry) => entry.file)), data: new Set(data.flatMap((/** @type {{ file?: string }} */ entry) => entry.file ?? [])), apps: data.flatMap((/** @type {{ app?: string }} */ entry) => entry.app ? [entry.app.replace(/\/$/, "")] : []) };
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
