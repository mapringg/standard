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
 * @returns {Promise<(file: string, specifier: string) => string | null>} The file a file's specifier names, relative to the root, or null. Only
 *   source files are ever reached, so a target in node_modules or outside the repo matches nothing.
 */
async function targets(repo) {
  const root = realpathSync(repo.root);
  const resolvers = await projects(root, repo.files("**/tsconfig.json").filter((path) => !path.split("/").includes("node_modules")), sourceFiles(repo));
  /** @type {Map<string, string | null>} */
  const resolved = new Map();
  /** @type {(file: string, specifier: string) => string | null} */
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

/** @type {(edges: ReadonlyMap<string, readonly (string | null)[]>, seeds: ReadonlyMap<string, string>) => Map<string, string>} Each file that reaches a seed along the edges, at any depth, to what that seed holds. */
function reach(edges, seeds) {
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

/** @type {(use: Parsed["uses"][number]) => string | null} What a use loads data through in the browser. */
const transport = ({ space, path }) => (space === "global" && (path === "fetch" || path.startsWith("fetch.")) ? "fetch" : null);

/** @type {import("../registry.mjs").Check} */
export default {
  name: "client-data",
  since: "0.14.13",
  doc: {
    enforces: "Only a file that `client-data` lists, with its reason, calls `useSWR`, from the app's `src/lib/swr.ts` under any of its names or from swr itself. A `\"use client\"` file that it does not list reads no `fetch` and imports no module that `api-modules` matches, directly or through modules without a directive. Tests, stories and fixtures are exempt.",
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
    const exported = reach(new Map(files.map((file) => [file.path, [...new Set(file.exports.filter((item) => item.space === "module").map((item) => moduleOf(item.path)))].map((specifier) => target(file.path, specifier))])), new Map([...templates].map((path) => [path, path])));
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
    return [...Map.groupBy(sites, (site) => site.key)].map(([key, [first, ...rest]]) => {
      const lines = [...new Set([first.line, ...rest.map((site) => site.line)])].sort((a, b) => a - b);
      return { key, group: first.group, fix: `${first.file} ${first.said} on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}, ${first.fix}` };
    });
  },
};
