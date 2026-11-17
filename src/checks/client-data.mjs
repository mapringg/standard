import { posix } from "node:path";

import { FILE } from "../config.mjs";
import { dependents, NOT_PRODUCT } from "./support/packages.mjs";
import { moduleOf, reach, reExports, targets } from "./support/reach.mjs";
import { sourceFacts } from "./support/source.mjs";

/**
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {import("./support/source.mjs").Parsed} Parsed
 * @typedef {{ file: string, key: string, group: string, line: number, said: string, fix: string }} Site
 */

const LISTED = "client-data/listed";
const CONFIG = "client-data/config";
const CLIENT_FETCH = "client-data/no-client-fetch";
const TEMPLATE = "src/lib/swr.ts";
/** The template's `useSWR` under its current and former names. A rename keeps the finding's key, so a baseline survives it. */
const HOOKS = new Set(["useSWR", "useServerData", "useServerSeeded"]);
/** swr's own hooks, which the template wraps and `react/no-direct-swr` bans elsewhere. */
const SWR_HOOK = /^swr(?:#(?:default|useSWR)|\/immutable#default)(?:\.|$)/;
/** The browser's request globals and the HTTP client packages built on them. */
const GLOBALS = new Set(["fetch", "XMLHttpRequest"]);
const CLIENTS = new Set(["ky", "axios"]);
const LISTED_FIX = `Read the data in a Server Component and pass it down as props, and send a write through a Server Action that refreshes the cache with revalidatePath or revalidateTag. If the browser must load the data, list the file in client-data in ${FILE} with its reason: pages, live, client-state or unreachable.`;
const FETCH_FIX = `Read the data in a Server Component and pass it down as props, and send a write through a Server Action. If the browser must load the data, list the file in client-data in ${FILE} with its reason: pages, live, client-state or unreachable.`;
const BROWSER = 'and "use client" runs it in the browser.';

/** @type {(use: Parsed["uses"][number]) => string | null} The request global or HTTP client package a use loads data through. */
const transport = ({ space, path, kind }) => {
  const [name] = (space === "global" ? path : moduleOf(path)).split(space === "global" ? "." : "/");
  if (space === "global") return GLOBALS.has(name) ? name : null;
  return CLIENTS.has(name) && kind !== "type" ? name : null;
};

/** @type {import("../registry.mjs").Check} */
export default {
  name: "client-data",
  since: "0.14.13",
  doc: {
    enforces: "Only a file that `client-data` lists, with its reason, calls `useSWR`, from the app's `src/lib/swr.ts` under any of its names or from swr itself. A `\"use client\"` file that it does not list reads no `fetch` or `XMLHttpRequest`, imports no `ky` or `axios`, and imports no module that `api-modules` matches, directly or through modules without a directive. Tests, stories and fixtures are exempt.",
    fix: "Read data in a Server Component and pass it as props, and write through a Server Action, or list the file in `client-data` with why the browser must load it.",
    config: ["client-data", "api-modules"],
  },
  subject: "tree",
  retired: [],
  applies: (repo) => (dependents(repo, "react").length > 0 ? { on: true } : { on: false, because: "no tracked package.json declares react" }),
  async run(repo) {
    const listed = (/** @type {string} */ path) => repo.config.clientData.some((entry) => ("file" in entry ? entry.file === path : path.startsWith(`${entry.app}/`)));
    const files = sourceFacts(repo).flatMap((file) => ("error" in file ? [] : [file]));
    const target = await targets(repo);
    const templates = new Set(dependents(repo, "react").map((app) => posix.join(app, TEMPLATE)));
    const exported = reach(reExports(files, target), new Map([...templates].map((path) => [path, path])));
    const plain = files.filter((file) => !file.client && !file.server && !listed(file.path));
    const seeds = new Map(plain.flatMap((file) => file.uses.map(transport).filter((what) => what !== null).slice(0, 1).map((what) => [file.path, `${what} in ${file.path}`])));
    for (const { path } of files) if (repo.config.apiModules.some((glob) => posix.matchesGlob(path, glob))) seeds.set(path, `the API module ${path}`);
    const loads = reach(new Map(plain.map((file) => [file.path, file.uses.filter((use) => use.space === "module" && use.kind === "import").map((use) => target(file.path, moduleOf(use.path)))])), seeds);
    /** @type {(file: string, path: string) => string | undefined} The hook a module use names: the template's useSWR, by any of its names, or swr's own. */
    const hookOf = (file, path) => {
      if (SWR_HOOK.test(path)) return "useSWR";
      const [name] = path.slice(moduleOf(path).length + 1).split(".");
      const found = target(file, moduleOf(path));
      return HOOKS.has(name) && found !== null && exported.has(found) ? name : undefined;
    };
    /** @type {Site[]} */
    const sites = [];
    for (const file of files.filter((item) => !NOT_PRODUCT.test(item.path) && !listed(item.path) && !templates.has(item.path))) {
      for (const use of file.uses) {
        const { space, path, kind, line } = use;
        const hook = space === "module" && kind !== "type" ? hookOf(file.path, path) : undefined;
        if (hook) {
          sites.push({ file: file.path, key: `${file.path} useSWR`, group: LISTED, line, said: `uses ${hook}`, fix: `and client-data in ${FILE} does not list it. ${LISTED_FIX}` });
        }
        if (!file.client) continue;
        const what = transport(use);
        if (what !== null) sites.push({ file: file.path, key: `${file.path} ${what}`, group: CLIENT_FETCH, line, said: `uses ${what}`, fix: `${BROWSER} ${FETCH_FIX}` });
        const specifier = moduleOf(path);
        const found = space === "module" && kind === "import" ? target(file.path, specifier) : null;
        const reached = found === null ? undefined : loads.get(found);
        if (reached) sites.push({ file: file.path, key: `${file.path} imports ${specifier}`, group: CLIENT_FETCH, line, said: `imports ${specifier}`, fix: `which reaches ${reached}, ${BROWSER} ${FETCH_FIX}` });
      }
    }
    const tracked = repo.files();
    /** @type {import("../registry.mjs").Finding[]} */
    const config = [];
    for (const entry of repo.config.clientData) {
      const path = "file" in entry ? entry.file : entry.app;
      const missing = "file" in entry ? (tracked.includes(path) ? null : "which git does not track") : tracked.some((item) => item.startsWith(`${path}/`)) ? null : "which holds no tracked file";
      if (missing) config.push({ key: `client-data ${path}`, group: CONFIG, fix: `client-data in ${FILE} lists ${path}, ${missing}. Remove the entry, or fix its path.` });
    }
    const [next] = dependents(repo, "next");
    if (next !== undefined && repo.config.apiModules.length === 0) {
      config.push({ key: "api-modules", group: CONFIG, fix: `api-modules in ${FILE} is empty, and ${next} is a Next app. List the globs of its API modules, so that a "use client" file that imports one fails.` });
    }
    return [...config, ...[...Map.groupBy(sites, (site) => site.key)].map(([key, [first, ...rest]]) => {
      const lines = [...new Set([first.line, ...rest.map((site) => site.line)])].sort((a, b) => a - b);
      return { key, group: first.group, fix: `${first.file} ${first.said} on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}, ${first.fix}` };
    })];
  },
};
