import { posix } from "node:path";

import { parseSync } from "oxc-parser";

import base from "../../config/tsconfig.json" with { type: "json" };
import { tracked } from "../repo.mjs";
import { checkJobScripts, RUNS_TYPECHECK } from "../wiring.mjs";

/**
 * @typedef {import("../registry.mjs").Finding} Finding
 * @typedef {import("../repo.mjs").Repo} Repo
 * @typedef {Readonly<Record<string, unknown>>} Options
 *
 * @typedef {{ extends: unknown[], options: Options, solution: boolean }} Tsconfig
 * @typedef {(path: string) => Tsconfig | string | null} Load A string says why the file is not JSON with comments. Null means git does not track it.
 *
 * What one project is built from, in the order tsc applies it. A later layer overrides an earlier one.
 * @typedef {{ kind: "base" }
 *   | { kind: "local", path: string, options: Options }
 *   | { kind: "preset", specifier: string, from: string }
 *   | { kind: "broken", key: string, fix: string }} Layer
 */

const BASE = "@mapringg/standard/tsconfig";
const FLAGS = Object.entries(base.compilerOptions);
const TSCONFIG = /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/;

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
  const { program, errors } = parseSync("tsconfig.js", `(${text})`);
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
 * @param {Repo} repo
 * @returns {Load}
 */
function loader(repo) {
  const files = new Set(repo.files());
  /** @type {Map<string, Tsconfig | string | null>} */
  const memo = new Map();
  return (path) => {
    if (!memo.has(path)) memo.set(path, files.has(path) ? read(repo.read(path)) : null);
    return /** @type {Tsconfig | string | null} */ (memo.get(path));
  };
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
  return {
    extends: json.extends === undefined ? [] : [json.extends].flat(),
    options: record(json.compilerOptions) ?? {},
    solution: Array.isArray(json.files) && json.files.length === 0 && !("include" in json),
  };
}

/**
 * @param {string} path
 * @param {Load} load
 * @param {readonly string[]} [seen] Files on the way from the root, to stop a cycle.
 * @returns {Layer[]}
 */
function layers(path, load, seen = []) {
  const file = load(path);
  if (typeof file === "string") return [{ kind: "broken", key: path, fix: `Make ${path} valid JSON with comments. ${file}.` }];
  if (file === null) return [];
  /** @type {Layer[]} */
  const chain = [];
  for (const specifier of file.extends) {
    const key = `${path} extends ${specifier}`;
    if (typeof specifier !== "string") {
      chain.push({ kind: "broken", key: `${path} extends`, fix: `Make extends in ${path} a string or a list of strings.` });
    } else if (specifier === BASE) {
      chain.push({ kind: "base" });
    } else if (!/^\.\.?\//.test(specifier)) {
      chain.push({ kind: "preset", specifier, from: path });
    } else {
      const target = posix.join(posix.dirname(path), specifier);
      const found = [target, `${target}.json`].find((candidate) => load(candidate) !== null);
      if (found === undefined) {
        chain.push({ kind: "broken", key, fix: `Point extends in ${path} at a file git tracks. "${specifier}" names ${target}, which it does not.` });
      } else if ([...seen, path].includes(found)) {
        chain.push({ kind: "broken", key, fix: `Remove "${specifier}" from extends in ${path}, which leads back to ${found} in a cycle.` });
      } else {
        chain.push(...layers(found, load, [...seen, path]));
      }
    }
  }
  chain.push({ kind: "local", path, options: file.options });
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
    if (chain.some((layer) => layer.kind === "local" && layer.path !== root && roots.has(layer.path))) return [];
    return [{ key: `${root} extends`, fix: `Add "${BASE}" as the last entry of extends in ${root}, so the project builds on the shared strict flags.` }];
  }
  return chain.slice(at + 1).flatMap((layer) => {
    if (layer.kind === "preset") {
      return [{ key: `${layer.from} extends ${layer.specifier}`, fix: `Move "${layer.specifier}" before "${BASE}" in extends of ${layer.from}, since a later entry overrides an earlier one.` }];
    }
    if (layer.kind !== "local") return [];
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
 * @param {readonly string[]} projects Paths of the roots named tsconfig.json.
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
          findings.push({ key: `${manifest} scripts.typecheck`, fix: `Add a typecheck script such as "tsc --noEmit" to ${manifest}, so the root typecheck covers ${project}.` });
        }
        break;
      }
      if (folder === ".") break;
    }
  }
  if (!repo.config.hooks["pre-push"].some((line) => RUNS_TYPECHECK.test(line))) {
    findings.push({ key: "hooks.pre-push", fix: `Add "pnpm typecheck" to hooks.pre-push in .standard/config.json, so a push that fails typecheck stops before CI.` });
  }
  const scripts = checkJobScripts(repo);
  if (scripts.length > 0 && !scripts.some((script) => RUNS_TYPECHECK.test(script))) {
    findings.push({ key: "ci", fix: `Run "pnpm typecheck" in a step of the Check job that has no continue-on-error, so a pull request that fails typecheck cannot merge.` });
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
    const load = loader(repo);
    const roots = repo.files().filter((path) => {
      const file = TSCONFIG.test(path) ? load(path) : null;
      return file !== null && (typeof file === "string" || !file.solution);
    });
    const findings = [
      ...roots.flatMap((root) => judge(root, layers(root, load), new Set(roots))),
      ...runs(repo, roots.filter((root) => posix.basename(root) === "tsconfig.json")),
    ];
    return findings.filter((finding, index) => findings.findIndex((other) => other.key === finding.key) === index);
  },
};
