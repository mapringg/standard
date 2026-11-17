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

/** Module mocking through vitest or jest, imported or as a global, banned in every source file before the repository's own entries. */
const BUILT_IN = /** @type {readonly BannedRule[]} */ ([
  { space: "module", objects: ["vitest#vi", "@jest/globals#jest"] },
  { space: "global", objects: ["vi", "jest"] },
].map(({ space, objects }) => ({
  space,
  paths: objects.flatMap((object) => ["mock", "doMock", "unmock", "unstable_mockModule"].map((name) => `${object}.${name}`)),
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
 * @returns {Finding[]} One per banned API the file uses, with every line in the fix.
 */
function findings(file, rules) {
  /** @type {Map<string, { lines: Set<number>, fix: string }>} */
  const found = new Map();
  /** @type {Set<unknown>} */
  const claimed = new Set();
  /** @type {(api: string, line: number, fix: string) => void} */
  const add = (api, line, fix) => {
    if (!found.has(api)) found.set(api, { lines: new Set(), fix });
    found.get(api)?.lines.add(line);
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
  return [...found].map(([api, { lines, fix }]) => {
    const sorted = [...lines].sort((a, b) => a - b);
    return { key: `${file.path} ${api}`, fix: `${file.path} uses ${api} on line${sorted.length > 1 ? "s" : ""} ${sorted.join(", ")}. ${fix}` };
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
