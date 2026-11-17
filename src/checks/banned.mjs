import { posix } from "node:path";

import { parseSync } from "oxc-parser";

import { FILE } from "../config.mjs";
import { sourceFacts } from "./support/source.mjs";

/**
 * @typedef {import("../registry.mjs").Finding} Finding
 * @typedef {import("../config.mjs").BannedRule} BannedRule
 */

const SECOND_WAY = "bans APIs a second way beside banned";

/** oxlint rule options do not merge, so a config that sets one of these replaces the shared one for its files. */
const OXLINT_RULES = new Map([
  ["no-restricted-properties", "replaces the bans on Reflect from @mapringg/standard/oxlint for the files it covers"],
  ["no-restricted-imports", SECOND_WAY],
  ["no-restricted-globals", SECOND_WAY],
]);

/**
 * Each test runner's members that replace a module, restore one, switch automocking, or hand back a mocked module, from the VitestUtils
 * interface of vitest 5.1.0 and the Jest interface of @jest/environment 30.5.2. Members that read the real module, such as importActual
 * and requireActual, stay allowed.
 */
const MOCKING = [
  { module: "vitest", object: "vi", members: ["mock", "doMock", "unmock", "doUnmock", "importMock"] },
  {
    module: "@jest/globals",
    object: "jest",
    members: ["mock", "doMock", "setMock", "unstable_mockModule", "unmock", "dontMock", "deepUnmock", "unstable_unmockModule", "enableAutomock", "disableAutomock", "autoMockOn", "autoMockOff", "requireMock", "createMockFromModule", "onGenerateMock"],
  },
];

/** Module mocking through vitest or jest, imported or as a global, banned in every source file before the repository's own entries. */
const BUILT_IN = /** @type {readonly BannedRule[]} */ (MOCKING.flatMap(({ module, object, members }) => [
  { space: "module", paths: members.map((name) => `${module}#${object}.${name}`) },
  { space: "global", paths: members.map((name) => `${object}.${name}`) },
]).map((rule) => ({
  ...rule,
  files: [],
  except: [],
  fix: "Pass the dependency in as an argument or prop, or run a fake of the service it calls, instead of replacing the module.",
})));

const OXLINT_CONFIG = /(?:^|\/)(?:[^/]*\.)?oxlintrc\.json$|(?:^|\/)oxlint\.config\.[cm]?[jt]s$/;

/** @type {(rule: BannedRule, path: string) => boolean} */
function covers(rule, path) {
  const matches = (/** @type {string} */ glob) => posix.matchesGlob(path, glob);
  return (rule.files.length === 0 || rule.files.some(matches)) && !rule.except.some(matches);
}

/** @type {(rule: BannedRule, path: string, use: string) => boolean} A path covers itself and every longer use: `react` covers `react#useMemo`, which covers `react#useMemo.call`. */
const under = (rule, path, use) => use === path || use.startsWith(path + (rule.space === "module" && !path.includes("#") ? "#" : "."));

/**
 * @param {import("./support/source.mjs").Parsed} file
 * @param {readonly BannedRule[]} rules The built-in bans, then config order. Each use counts once, for the first rule that covers the file and the use.
 * @returns {Finding[]} One per banned API the file uses or test runner object it re-exports, with every line in the fix.
 */
function findings(file, rules) {
  /** @type {Map<string, { lines: Set<number>, fix: string, said: string }>} */
  const found = new Map();
  /** @type {Set<unknown>} */
  const claimed = new Set();
  /** @type {(key: string, line: number, fix: string, said?: string) => void} */
  const add = (key, line, fix, said = `uses ${key}`) => {
    if (!found.has(key)) found.set(key, { lines: new Set(), fix, said });
    found.get(key)?.lines.add(line);
  };
  for (const rule of rules.filter((rule) => covers(rule, file.path))) {
    if (rule.space === "property") {
      for (const name of rule.paths.filter((name) => !claimed.has(name))) {
        claimed.add(name);
        for (const line of file.members.get(name) ?? []) add(`.${name}`, line, rule.fix);
      }
      continue;
    }
    for (const use of file.uses.filter((use) => use.kind !== "type" && use.space === rule.space && !claimed.has(use))) {
      const api = rule.paths.find((path) => under(rule, path, use.path));
      if (api === undefined) continue;
      claimed.add(use);
      add(api, use.line, rule.fix);
    }
  }
  for (const { space, path, line } of file.exports) {
    const runner = MOCKING.find(({ module, object }) => (space === "module" ? path === module || path === `${module}#${object}` : path === object));
    if (!runner) continue;
    const api = space === "module" ? `${runner.module}#${runner.object}` : runner.object;
    add(`export ${api}`, line, `Import ${runner.object} from ${runner.module} where you use it.`, `re-exports ${api}`);
  }
  return [...found].map(([key, { lines, fix, said }]) => {
    const sorted = [...lines].sort((a, b) => a - b);
    return { key: `${file.path} ${key}`, fix: `${file.path} ${said} on line${sorted.length > 1 ? "s" : ""} ${sorted.join(", ")}. ${fix}` };
  });
}

/** @type {(repo: import("../repo.mjs").Repo) => Finding[]} One per tracked oxlint config and restricted rule it names at any depth, with any value, "off" included. */
function oxlintConflicts(repo) {
  const configs = repo.files().filter((path) => OXLINT_CONFIG.test(path) && !path.split("/").includes("node_modules"));
  return configs.flatMap((path) => {
    const text = repo.read(path);
    const { program } = path.endsWith(".json") ? parseSync(`${path}.ts`, `(${text}\n)`) : parseSync(path, text);
    /** @type {Set<string>} */
    const rules = new Set();
    /** @type {(node: unknown) => void} */
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      const { type, key } = /** @type {{ type?: string, key?: { name?: string, value?: unknown } }} */ (node);
      const rule = type === "Property" ? String(key?.name ?? key?.value).split("/").at(-1) : undefined;
      if (rule && OXLINT_RULES.has(rule)) rules.add(rule);
      Object.values(node).forEach(visit);
    };
    visit(program);
    return [...rules].map((rule) => ({
      key: `${path} ${rule}`,
      fix: `${path} sets ${rule}, which ${OXLINT_RULES.get(rule)}. Move its entries to banned in ${FILE}, and delete the rule from rules and every overrides entry.`,
    }));
  });
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "banned",
  since: "0.12.0",
  doc: {
    enforces: "A file uses no API the repository bans, and no oxlint config bans APIs a second way.",
    fix: "Use what the entry's `fix` names instead.",
    config: ["banned"],
  },
  subject: "tree",
  baseline: false,
  retired: ["no-process-env", "no-bare-json-parse", "no-module-mocking", "no-manual-memo"].flatMap((rule) => [`packages/oxlint-plugin-*/rules/${rule}.ts`, `packages/oxlint-plugin-*/rules/${rule}.test.ts`]),
  applies: () => ({ on: true }),
  run(repo) {
    const rules = [...BUILT_IN, ...repo.config.banned];
    const parseError = (/** @type {{ path: string, error: string }} */ file) => ({ key: `${file.path} parse`, fix: `${file.path} does not parse, so banned cannot read it: ${file.error}. Fix the syntax.` });
    return [...oxlintConflicts(repo), ...sourceFacts(repo).flatMap((file) => ("error" in file ? [parseError(file)] : findings(file, rules)))];
  },
};
