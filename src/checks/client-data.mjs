import { realpathSync } from "node:fs";
import { posix } from "node:path";

import { FILE } from "../config.mjs";
import { dependents, NOT_PRODUCT } from "./support/packages.mjs";
import { projects } from "./support/resolve.mjs";
import { sourceFacts } from "./support/source.mjs";
import { sourceFiles } from "./support/sources.mjs";

/**
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {import("./support/source.mjs").Parsed} Parsed
 * @typedef {{ file: string, key: string, group: string, line: number, said: string, fix: string }} Site
 */

const LISTED = "client-data/listed";
const CLIENT_FETCH = "client-data/no-client-fetch";
const TEMPLATE = "src/lib/swr.ts";
/** The template's `useSWR` under its current and former names. A rename keeps the finding's key, so a baseline survives it. */
const HOOKS = new Set(["useSWR", "useServerData", "useServerSeeded"]);
/** swr's own hook, which the template wraps and `react/no-direct-swr` bans elsewhere. */
const SWR_HOOK = /^swr#(?:default|useSWR)(?:\.|$)/;
const LISTED_FIX = `Read the data in a Server Component and pass it down as props, and send a write through a Server Action that refreshes the cache with revalidatePath or revalidateTag. If the browser must load the data, list the file in client-data in ${FILE} with its reason: pages, live, client-state or unreachable.`;
const FETCH_FIX = `Read the data in a Server Component and pass it down as props, and send a write through a Server Action. If the browser must load the data, list the file in client-data in ${FILE} with its reason.`;
const BROWSER = 'and "use client" runs it in the browser.';

/** @type {(path: string) => string} The module a use path names: `@/api/users` for `@/api/users#getUser`. A subpath import such as `#api` keeps its leading `#`. */
const moduleOf = (path) => (path.indexOf("#", 1) === -1 ? path : path.slice(0, path.indexOf("#", 1)));

/**
 * @param {Repo} repo
 * @param {readonly Parsed[]} files
 * @returns {Promise<(seeds: ReadonlySet<string>) => (file: string, specifier: string) => string | null>} For a set of repo files, the one a
 * file reaches through a specifier: a seed, or a file that re-exports one at any depth. Null when the specifier reaches none.
 */
async function reachers(repo, files) {
  const root = realpathSync(repo.root);
  const resolvers = await projects(root, repo.files("**/tsconfig.json").filter((path) => !path.split("/").includes("node_modules")), sourceFiles(repo));
  /** @type {Map<string, string | null>} */
  const resolved = new Map();
  /** @type {(file: string, specifier: string) => string | null} */
  const resolve = (file, specifier) => {
    const found = resolvers.of(file).resolve(posix.join(root, file), specifier, "import", true, "static");
    const relative = found === null || found === "builtin" ? null : posix.relative(root, found);
    return relative === null || relative.startsWith("../") || relative.split("/").includes("node_modules") ? null : relative;
  };
  /** @type {(file: string, specifier: string) => string | null} */
  const target = (file, specifier) => {
    const at = `${file}\0${specifier}`;
    if (!resolved.has(at)) resolved.set(at, resolve(file, specifier));
    return resolved.get(at) ?? null;
  };
  const barrels = files.map((file) => ({ path: file.path, from: [...new Set(file.exports.filter((item) => item.space === "module").map((item) => moduleOf(item.path)))].map((specifier) => target(file.path, specifier)) }));
  return (seeds) => {
    const reached = new Set(seeds);
    for (let grew = true; grew;) {
      const before = reached.size;
      for (const { path, from } of barrels) if (from.some((source) => source !== null && reached.has(source))) reached.add(path);
      grew = reached.size > before;
    }
    return (file, specifier) => {
      const found = target(file, specifier);
      return found !== null && reached.has(found) ? found : null;
    };
  };
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "client-data",
  since: "0.14.13",
  doc: {
    enforces: "Only a file that `client-data` lists, with its reason, calls `useSWR`, from the app's `src/lib/swr.ts` under any of its names or from swr itself. A `\"use client\"` file that it does not list reads no `fetch` and imports no module that `api-modules` matches, directly or through a re-export. Tests, stories and fixtures are exempt.",
    fix: "Read data in a Server Component and pass it as props, and write through a Server Action, or list the file in `client-data` with why the browser must load it.",
    config: ["client-data", "api-modules"],
  },
  subject: "tree",
  retired: [],
  applies: (repo) => (dependents(repo, "react").length > 0 ? { on: true } : { on: false, because: "no tracked package.json declares react" }),
  async run(repo) {
    const listed = (/** @type {string} */ path) => repo.config.clientData.some((entry) => ("file" in entry ? entry.file === path : path.startsWith(`${entry.app}/`)));
    const files = sourceFacts(repo).flatMap((file) => ("error" in file ? [] : [file]));
    const reach = await reachers(repo, files);
    const paths = files.map((file) => file.path);
    const templates = new Set(dependents(repo, "react").map((app) => posix.join(app, TEMPLATE)));
    const reachesApi = reach(new Set(paths.filter((path) => repo.config.apiModules.some((glob) => posix.matchesGlob(path, glob)))));
    const reachesTemplate = reach(templates);
    /** @type {(file: string, path: string) => string | undefined} The hook a module use names: the template's useSWR, by any of its names, or swr's own. */
    const hookOf = (file, path) => {
      if (SWR_HOOK.test(path)) return "useSWR";
      const [name] = path.slice(moduleOf(path).length + 1).split(".");
      return HOOKS.has(name) && reachesTemplate(file, moduleOf(path)) !== null ? name : undefined;
    };
    /** @type {Site[]} */
    const sites = [];
    for (const file of files.filter((item) => !NOT_PRODUCT.test(item.path) && !listed(item.path) && !templates.has(item.path))) {
      for (const { space, path, kind, line } of file.uses) {
        const hook = space === "module" && kind !== "type" ? hookOf(file.path, path) : undefined;
        if (hook) {
          sites.push({ file: file.path, key: `${file.path} useSWR`, group: LISTED, line, said: `uses ${hook}`, fix: `and client-data in ${FILE} does not list it. ${LISTED_FIX}` });
        }
        if (!file.client) continue;
        if (space === "global" && (path === "fetch" || path.startsWith("fetch."))) {
          sites.push({ file: file.path, key: `${file.path} fetch`, group: CLIENT_FETCH, line, said: "uses fetch", fix: `${BROWSER} ${FETCH_FIX}` });
        }
        const specifier = moduleOf(path);
        const api = space === "module" && kind === "import" ? reachesApi(file.path, specifier) : null;
        if (api !== null) sites.push({ file: file.path, key: `${file.path} imports ${specifier}`, group: CLIENT_FETCH, line, said: `imports ${specifier}`, fix: `which reaches the API module ${api}, ${BROWSER} ${FETCH_FIX}` });
      }
    }
    return [...Map.groupBy(sites, (site) => site.key)].map(([key, [first, ...rest]]) => {
      const lines = [...new Set([first.line, ...rest.map((site) => site.line)])].sort((a, b) => a - b);
      return { key, group: first.group, fix: `${first.file} ${first.said} on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}, ${first.fix}` };
    });
  },
};
