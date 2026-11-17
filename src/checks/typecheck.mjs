import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { posix } from "node:path";

import { parseSync } from "oxc-parser";

import base from "../../config/tsconfig.json" with { type: "json" };
import { tracked } from "../repo.mjs";
import { checkJobScripts, runsTypecheck } from "../wiring.mjs";

/**
 * @typedef {import("../registry.mjs").Finding} Finding
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {Readonly<Record<string, unknown>>} Options
 *
 * @typedef {{ extends: unknown[], options: Options, solution: boolean }} Tsconfig
 *
 * Reads tsconfig files by absolute path. A file inside the repository counts only when git tracks it;
 * a file under node_modules is read from disk.
 * @typedef {object} Files
 * @property {(path: string) => boolean} exists
 * @property {(path: string) => Tsconfig | string} load A string says why the file is not a tsconfig.
 * @property {(path: string) => string} shown Repo-relative, or from the last node_modules on.
 *
 * What one project is built from, in the order tsc applies it. A later layer overrides an earlier one.
 * @typedef {{ kind: "base" }
 *   | { kind: "file", path: string, options: Options }
 *   | { kind: "late", key: string, fix: string }
 *   | { kind: "broken", key: string, fix: string }} Layer
 */

const BASE = "@mapringg/standard/tsconfig";
const FLAGS = Object.entries(base.compilerOptions);
const TSCONFIG = /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/;
const CONDITIONS = new Set(["types", "node", "import", "require", "default"]);

/**
 * @param {any} node
 * @returns {unknown}
 */
function value(node) {
  switch (node?.type) {
    case "ParenthesizedExpression":
      return value(node.expression);
    case "Literal":
      if (node.regex === undefined && typeof node.value !== "bigint") return node.value;
      break;
    case "UnaryExpression":
      if (node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number") return -node.argument.value;
      break;
    case "ArrayExpression":
      return node.elements.map(value);
    case "ObjectExpression":
      return Object.fromEntries(
        node.properties.map((/** @type {any} */ property) => {
          if (property.type !== "Property" || property.kind !== "init" || property.computed || property.method || typeof property.key.value !== "string") {
            throw new Error("a key is not a quoted string");
          }
          return [property.key.value, value(property.value)];
        }),
      );
  }
  throw new Error(`it holds ${node?.type ?? "a hole"}, which is not JSON`);
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJsonc(text) {
  // The newline ends a line comment on the last line, which would otherwise swallow the closing parenthesis.
  const { program, errors } = parseSync("tsconfig.js", `(${text}\n)`);
  if (errors.length > 0) throw new Error(errors[0].message);
  const [statement, ...rest] = program.body;
  if (statement?.type !== "ExpressionStatement" || rest.length > 0) throw new Error("it is not one value");
  return value(statement.expression);
}

/**
 * @param {unknown} it
 * @returns {Record<string, unknown> | null}
 */
function record(it) {
  return typeof it === "object" && it !== null && !Array.isArray(it) ? /** @type {Record<string, unknown>} */ (it) : null;
}

/**
 * @param {string} text
 * @returns {Tsconfig | string}
 */
function read(text) {
  let json;
  try {
    json = record(parseJsonc(text));
  } catch (error) {
    return /** @type {Error} */ (error).message;
  }
  if (json === null) return "it is not an object";
  const options = json.compilerOptions === undefined ? {} : record(json.compilerOptions);
  if (options === null) return "compilerOptions is not an object";
  return {
    extends: json.extends === undefined ? [] : [json.extends].flat(),
    options,
    solution: Array.isArray(json.files) && json.files.length === 0 && !("include" in json),
  };
}

/**
 * @param {Repo} repo
 * @returns {Files}
 */
function files(repo) {
  const trackedPaths = new Set(repo.files());
  const inside = (/** @type {string} */ path) => {
    const relative = posix.relative(repo.root, path);
    return relative.startsWith("../") || relative.split("/").includes("node_modules") ? null : relative;
  };
  /** @type {Map<string, Tsconfig | string>} */
  const memo = new Map();
  return {
    exists(path) {
      const relative = inside(path);
      return relative === null ? existsSync(path) && statSync(path).isFile() : trackedPaths.has(relative);
    },
    load(path) {
      if (!memo.has(path)) {
        const relative = inside(path);
        memo.set(path, read(relative === null ? readFileSync(path, "utf8") : repo.read(relative)));
      }
      return /** @type {Tsconfig | string} */ (memo.get(path));
    },
    shown(path) {
      const relative = inside(path);
      return relative ?? `node_modules/${path.split("/node_modules/").at(-1)}`;
    },
  };
}

/**
 * @param {unknown} target
 * @returns {string | null} The first path a package exports entry gives under the conditions tsc reads.
 */
function exported(target) {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) return target.map(exported).find((path) => path !== null) ?? null;
  for (const [condition, inner] of Object.entries(record(target) ?? {})) {
    const path = CONDITIONS.has(condition) ? exported(inner) : null;
    if (path !== null) return path;
  }
  return null;
}

/**
 * @param {unknown} exports
 * @param {string} subpath "." or "./<rest>"
 * @returns {string | null}
 */
function subpathTarget(exports, subpath) {
  const map = Object.keys(record(exports) ?? {}).some((key) => key.startsWith(".")) ? /** @type {Record<string, unknown>} */ (exports) : { ".": exports };
  if (subpath in map) return exported(map[subpath]);
  for (const [key, target] of Object.entries(map)) {
    const [before, after, extra] = key.split("*");
    if (after === undefined || extra !== undefined) continue;
    if (subpath.length >= key.length - 1 && subpath.startsWith(before) && subpath.endsWith(after)) {
      return exported(target)?.replaceAll("*", subpath.slice(before.length, subpath.length - after.length)) ?? null;
    }
  }
  return null;
}

/**
 * tsc's lookup for a package name in extends: the nearest node_modules folder that holds the package,
 * then its exports, or without exports its tsconfig field, the subpath, the subpath with .json, or a tsconfig.json.
 * @param {string} specifier
 * @param {string} folder
 * @returns {string | null}
 */
function packageConfig(specifier, folder) {
  const match = /^((?:@[^/]+\/)?[^/@][^/]*)(?:\/(.+))?$/.exec(specifier);
  if (match === null) return null;
  const [, name, rest] = match;
  for (let at = folder; ; at = posix.dirname(at)) {
    const root = posix.join(at, "node_modules", name);
    if (existsSync(root)) {
      let manifest = {};
      try {
        manifest = record(JSON.parse(readFileSync(posix.join(root, "package.json"), "utf8"))) ?? {};
      } catch {}
      const exports = /** @type {Record<string, unknown>} */ (manifest).exports;
      const tsconfigField = /** @type {Record<string, unknown>} */ (manifest).tsconfig;
      const candidates =
        exports !== undefined
          ? [subpathTarget(exports, rest === undefined ? "." : `./${rest}`)]
          : rest === undefined
            ? [typeof tsconfigField === "string" ? tsconfigField : null, "tsconfig.json"]
            : [rest, `${rest}.json`, `${rest}/tsconfig.json`];
      const found = candidates.flatMap((path) => (path === null ? [] : [posix.join(root, path)])).find((path) => existsSync(path) && statSync(path).isFile());
      return found === undefined ? null : realpathSync(found);
    }
    if (at === posix.dirname(at)) return null;
  }
}

/**
 * @param {string} specifier
 * @param {string} from Absolute path of the file whose extends names it.
 * @param {Files} known
 * @returns {string | null}
 */
function locate(specifier, from, known) {
  if (!/^(?:\.\.?\/|\/)/.test(specifier)) return packageConfig(specifier, posix.dirname(from));
  const target = posix.resolve(posix.dirname(from), specifier);
  if (known.exists(target)) return target;
  return !target.endsWith(".json") && known.exists(`${target}.json`) ? `${target}.json` : null;
}

/**
 * @param {string} path Absolute.
 * @param {Files} known
 * @param {readonly string[]} [seen] Files on the way from the root, to stop a cycle.
 * @returns {Layer[]}
 */
function layers(path, known, seen = []) {
  const shown = known.shown(path);
  const file = known.load(path);
  if (typeof file === "string") return [{ kind: "broken", key: shown, fix: `Make ${shown} a valid tsconfig. ${file}.` }];
  /** @type {Layer[]} */
  const chain = [];
  for (const specifier of file.extends) {
    const key = `${shown} extends ${specifier}`;
    const reached = chain.some((layer) => layer.kind === "base");
    if (typeof specifier !== "string") {
      chain.push({ kind: "broken", key: `${shown} extends`, fix: `Make extends in ${shown} a string or a list of strings.` });
      continue;
    }
    if (specifier === BASE) {
      chain.push({ kind: "base" });
      continue;
    }
    const target = locate(specifier, path, known);
    if (target === null) {
      chain.push({ kind: "broken", key, fix: `Make "${specifier}" in extends of ${shown} name a config TypeScript finds: a file git tracks, or an installed package's config.` });
    } else if ([...seen, path].includes(target)) {
      chain.push({ kind: "broken", key, fix: `Remove "${specifier}" from extends in ${shown}, which leads back to ${known.shown(target)} in a cycle.` });
    } else {
      if (reached && !specifier.startsWith(".") && !specifier.startsWith("/")) {
        chain.push({ kind: "late", key, fix: `Move "${specifier}" before "${BASE}" in extends of ${shown}, since a later entry overrides an earlier one.` });
      }
      chain.push(...layers(target, known, [...seen, path]));
    }
  }
  chain.push({ kind: "file", path: shown, options: file.options });
  return chain;
}

/**
 * @param {string} root
 * @param {readonly Layer[]} chain
 * @param {ReadonlySet<string>} roots
 * @returns {Finding[]}
 */
function judge(root, chain, roots) {
  const broken = chain.flatMap((layer) => (layer.kind === "broken" ? [{ key: layer.key, fix: layer.fix }] : []));
  if (broken.length > 0) return broken;
  const at = chain.findLastIndex((layer) => layer.kind === "base");
  if (at === -1) {
    if (chain.some((layer) => layer.kind === "file" && layer.path !== root && roots.has(layer.path))) return [];
    return [{ key: `${root} extends`, fix: `Add "${BASE}" as the last entry of extends in ${root}, so the project builds on the shared strict flags.` }];
  }
  return chain.slice(at + 1).flatMap((layer) => {
    if (layer.kind === "late") return [{ key: layer.key, fix: layer.fix }];
    if (layer.kind !== "file") return [];
    return FLAGS.filter(([flag, want]) => flag in layer.options && layer.options[flag] !== want).map(([flag, want]) => ({
      key: `${layer.path} compilerOptions.${flag}`,
      fix: `Remove compilerOptions.${flag} from ${layer.path}, which sets ${JSON.stringify(layer.options[flag])} where the shared base sets ${want}.`,
    }));
  });
}

/**
 * @param {Repo} repo
 * @param {string} path
 * @returns {boolean}
 */
function hasScript(repo, path) {
  try {
    return typeof JSON.parse(tracked(repo, path) ?? "{}").scripts?.typecheck === "string";
  } catch {
    return false;
  }
}

/**
 * @param {Repo} repo
 * @param {readonly string[]} projects
 * @returns {Finding[]}
 */
function runs(repo, projects) {
  const manifests = new Set(repo.files("**/package.json"));
  /** @type {Finding[]} */
  const findings = [];
  if (!hasScript(repo, "package.json")) {
    findings.push({ key: "package.json scripts.typecheck", fix: `Add a typecheck script such as "turbo run typecheck" to package.json, so CI and pre-push have one command to run.` });
  }
  for (const project of projects) {
    for (let folder = posix.dirname(project); ; folder = posix.dirname(folder)) {
      const manifest = posix.join(folder, "package.json");
      if (manifests.has(manifest)) {
        if (!hasScript(repo, manifest)) {
          const name = posix.basename(project);
          const command = name === "tsconfig.json" ? "tsc --noEmit" : `tsc --noEmit -p ${name}`;
          findings.push({ key: `${manifest} scripts.typecheck`, fix: `Add a typecheck script such as "${command}" to ${manifest}, so the root typecheck covers ${project}.` });
        }
        break;
      }
      if (folder === ".") break;
    }
  }
  if (!repo.config.hooks["pre-push"].some(runsTypecheck)) {
    findings.push({ key: "hooks.pre-push", fix: `Add "pnpm typecheck" to hooks.pre-push in .standard/config.json, so a push that fails typecheck stops before CI.` });
  }
  const scripts = checkJobScripts(repo);
  if (scripts.length > 0 && !scripts.some(runsTypecheck)) {
    findings.push({ key: "ci", fix: `Add a step to the Check job whose run is "pnpm typecheck", with no continue-on-error, so a pull request that fails typecheck cannot merge.` });
  }
  return findings;
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "typecheck",
  since: "0.9.0",
  subject: "tree",
  baseline: false,
  retired: [],
  applies: (repo) => (repo.files().some((path) => TSCONFIG.test(path)) ? { on: true } : { on: false, because: "git tracks no tsconfig.json" }),
  run(repo) {
    const known = files(repo);
    const roots = repo.files().filter((path) => {
      if (!TSCONFIG.test(path)) return false;
      const file = known.load(posix.join(repo.root, path));
      return typeof file === "string" || !file.solution;
    });
    const rootSet = new Set(roots);
    const findings = [...roots.flatMap((root) => judge(root, layers(posix.join(repo.root, root), known), rootSet)), ...runs(repo, roots)];
    return findings.filter((finding, index) => findings.findIndex((other) => other.key === finding.key) === index);
  },
};
