import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

import base from "../../config/tsconfig.json" with { type: "json" };
import { tracked } from "../repo.mjs";
import { checkJobScripts, runsScript } from "../wiring.mjs";

const RUNS_TYPECHECK = runsScript("typecheck");

/**
 * @typedef {import("../registry.mjs").Finding} Finding
 * @typedef {import("../repo.mjs").Repo} Repo
 *
 * What the repository's own TypeScript makes of one tsconfig.
 * @typedef {object} Parsed
 * @property {Readonly<Record<string, unknown>>} options The effective compilerOptions, after every extends.
 * @property {number} files How many input files the project has.
 * @property {readonly string[]} problems TypeScript's diagnostics for the config itself, such as a missing extends target.
 * @property {readonly string[]} configs Absolute paths of the config files TypeScript loaded for it.
 *
 * @typedef {(paths: readonly string[]) => Promise<Parsed[]>} Parser Parses absolute tsconfig paths with one TypeScript install.
 */

const PACKAGE = "@mapringg/standard";
const BASE = `${PACKAGE}/tsconfig`;
const FLAGS = Object.entries(base.compilerOptions);
const TSCONFIG = /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/;

/**
 * @param {string} root The folder of a typescript package.
 * @returns {Parser}
 */
function nativeParser(root) {
  return async (paths) => {
    const { API } = await import(pathToFileURL(posix.join(root, "dist/api/sync/api.js")).href);
    /** @type {string[]} */
    let reads = [];
    // TypeScript reads a config's text only to load it, so the reads while it parses one tsconfig are that tsconfig's chain.
    const api = new API({ fs: { readFile: (/** @type {string} */ path) => void reads.push(path) } });
    try {
      const parsed = paths.map((path) => {
        reads = [];
        const { options, fileNames } = api.parseConfigFile(path);
        return { options, files: fileNames.length, configs: reads.filter((read) => posix.basename(read) !== "package.json") };
      });
      const snapshot = api.updateSnapshot({ openProjects: [...paths] });
      try {
        return parsed.map((one, index) => {
          const project = snapshot.getProject(paths[index]);
          /** @type {{ code: number, text: string }[]} */
          const diagnostics = project?.program.getConfigFileParsingDiagnostics() ?? [{ code: 0, text: "TypeScript did not open it" }];
          return { ...one, problems: diagnostics.map(({ code, text }) => `TS${code}: ${text}`) };
        });
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  };
}

/**
 * @param {string} root The folder of a typescript package.
 * @returns {Parser}
 */
function classicParser(root) {
  return async (paths) => {
    const ts = createRequire(posix.join(root, "package.json"))("./lib/typescript.js");
    const cache = new Map();
    return paths.map((path) => {
      /** @type {any[]} */
      const fatal = [];
      const parsed = ts.getParsedCommandLineOfConfigFile(path, undefined, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (/** @type {any} */ diagnostic) => fatal.push(diagnostic) }, cache);
      return {
        options: parsed?.options ?? {},
        files: parsed?.fileNames.length ?? 0,
        problems: [...fatal, ...(parsed?.errors ?? [])].map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`),
        configs: [path, ...(parsed?.options.configFile?.extendedSourceFiles ?? [])],
      };
    });
  };
}

/**
 * @param {string} tsconfig Absolute path.
 * @returns {string | null} The folder of the typescript package that tsconfig's folder resolves, or null when it has none.
 */
function typescriptFor(tsconfig) {
  try {
    return posix.dirname(realpathSync(createRequire(tsconfig).resolve("typescript/package.json")));
  } catch {
    return null;
  }
}

/**
 * @param {string} path Absolute path of a config TypeScript loaded.
 * @returns {boolean} Whether it is the config/tsconfig.json of an installed @mapringg/standard.
 */
function isBase(path) {
  const real = realpathSync(path);
  for (let folder = posix.dirname(real); folder !== posix.dirname(folder); folder = posix.dirname(folder)) {
    const manifest = posix.join(folder, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      return JSON.parse(readFileSync(manifest, "utf8")).name === PACKAGE && posix.relative(folder, real) === "config/tsconfig.json";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * @param {Repo} repo
 * @param {readonly string[]} paths Repo-relative tsconfig paths.
 * @returns {Promise<{ parsed: Map<string, Parsed>, findings: Finding[] }>}
 */
async function parseAll(repo, paths) {
  /** @type {Map<string, string[]>} */
  const byInstall = new Map();
  /** @type {Finding[]} */
  const findings = [];
  for (const path of paths) {
    const install = typescriptFor(posix.join(repo.root, path));
    if (install === null) {
      findings.push({ key: `${path} typescript`, fix: `Add typescript to the devDependencies of the package that holds ${path} and run pnpm install, so the check reads it with the repository's own compiler.` });
    } else {
      byInstall.set(install, [...(byInstall.get(install) ?? []), path]);
    }
  }
  /** @type {Map<string, Parsed>} */
  const parsed = new Map();
  for (const [install, group] of byInstall) {
    const { version } = JSON.parse(readFileSync(posix.join(install, "package.json"), "utf8"));
    const parse = Number.parseInt(version, 10) >= 7 ? nativeParser(install) : classicParser(install);
    const results = await parse(group.map((path) => posix.join(repo.root, path)));
    group.forEach((path, index) => parsed.set(path, results[index]));
  }
  return { parsed, findings };
}

/**
 * @param {Repo} repo
 * @param {Map<string, Parsed>} parsed
 * @returns {Finding[]}
 */
function judge(repo, parsed) {
  const relative = (/** @type {string} */ path) => posix.relative(repo.root, path);
  /** @param {string} root */
  const parents = (root) => (parsed.get(root)?.configs ?? []).map(relative).filter((path) => path !== root && parsed.has(path));
  /** @param {string} root */
  const offFlags = (root) => {
    const { options } = /** @type {Parsed} */ (parsed.get(root));
    return FLAGS.filter(([flag, want]) => options[flag] !== want);
  };
  return [...parsed].flatMap(([root, { problems, configs }]) => {
    if (problems.length > 0) return [{ key: `${root} config`, fix: `Fix ${root} so TypeScript reads it without errors. ${problems.join(" ")}` }];
    if (!configs.some(isBase)) {
      if (parents(root).some((parent) => !(parsed.get(parent)?.configs ?? []).some(isBase))) return [];
      return [{ key: `${root} extends`, fix: `Add "${BASE}" as the last entry of extends in ${root}, so the project builds on the shared strict flags.` }];
    }
    const inherited = new Set(parents(root).flatMap((parent) => offFlags(parent).map(([flag]) => flag)));
    return offFlags(root)
      .filter(([flag]) => !inherited.has(flag))
      .map(([flag, want]) => ({
        key: `${root} compilerOptions.${flag}`,
        fix: `${root} ends up with ${flag} set to ${JSON.stringify(parsed.get(root)?.options[flag] ?? null)}, but the shared base sets ${want}. Remove the setting that overrides it, in ${root} or a config it extends after the base.`,
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
  if (!repo.config.hooks["pre-push"].some(RUNS_TYPECHECK)) {
    findings.push({ key: "hooks.pre-push", fix: `Add the line "pnpm typecheck" to hooks.pre-push in .standard/config.json, so a push that fails typecheck stops before CI.` });
  }
  const scripts = checkJobScripts(repo);
  if (scripts.length > 0 && !scripts.some(RUNS_TYPECHECK)) {
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
  async run(repo) {
    const { parsed, findings } = await parseAll(repo, repo.files().filter((path) => TSCONFIG.test(path)));
    for (const [path, { files, problems }] of parsed) {
      // A solution file lists no inputs on purpose; a project that finds none gets a TypeScript diagnostic instead.
      if (files === 0 && problems.length === 0) parsed.delete(path);
    }
    const projects = [...parsed.keys(), ...findings.map(({ key }) => key.replace(/ typescript$/, ""))];
    const all = [...findings, ...judge(repo, parsed), ...runs(repo, projects)];
    return all.filter((finding, index) => all.findIndex((other) => other.key === finding.key) === index);
  },
};
