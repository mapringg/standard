import { posix } from "node:path";

import { dependents, reactApps } from "./support/packages.mjs";
import { reducerStates } from "./support/reducer-state.mjs";
import { sourceFacts } from "./support/source.mjs";

/**
 * @typedef {import("./support/source.mjs").Parsed} Parsed
 * @typedef {import("./support/source.mjs").Use} Use
 *
 * What a rule sees: the repository root, every parsed source, and the one path in each React app that may import swr.
 * @typedef {{ root: string, files: readonly Parsed[], wrappers: ReadonlySet<string> }} Scope
 *
 * One occurrence. Occurrences that share a key share one fix, which lists all their lines, because the baseline shows
 * the first fix of each key.
 * @typedef {{ key: string, line: number, fix: (lines: string) => string }} Problem
 *
 * @typedef {{ name: string, find(scope: Scope): Problem[] | Promise<Problem[]> }} Rule
 */

const FLAG_STATES = new Set(["loading", "isLoading", "error", "isError"]);
const SWR = new Set(["swr", "swr/infinite", "swr/immutable"]);
const WRAPPER = "src/lib/swr.ts";
const UNION_FIX = 'Make the state a union with one member per status, such as { status: "idle" } | { status: "done", items: Item[] }.';
const OWNER = /^(?:[A-Z]|use[A-Z])/;

/**
 * @param {Parsed} file
 * @param {string} path
 * @returns {{ owner: string, key: string, use: Extract<Use, { kind: "call" }> }[]} Each call of the module export inside a
 * component or hook. `key` names the owner within the file: a second function of the same name gets "View 2", and so on in source order.
 */
function ownedCalls(file, path) {
  const owners = [...new Map(file.uses.flatMap((use) => (use.kind === "call" && use.call.owner ? [[use.call.owner.at, use.call.owner.name]] : [])))].sort(([a], [b]) => a - b);
  const keys = new Map(owners.map(([at, name], index) => {
    const count = owners.slice(0, index + 1).filter(([, other]) => other === name).length;
    return [at, `${file.path} ${name}${count > 1 ? ` ${count}` : ""}`];
  }));
  return file.uses.flatMap((use) => {
    if (use.kind !== "call" || use.space !== "module" || use.path !== path) return [];
    const { owner } = use.call;
    return owner !== null && (OWNER.test(owner.name) || owner.name === "default") ? [{ owner: owner.name, key: /** @type {string} */ (keys.get(owner.at)), use }] : [];
  });
}

/** @type {readonly Rule[]} */
const RULES = [
  {
    name: "react/single-use-state",
    find: ({ files }) =>
      files.flatMap((file) =>
        [...Map.groupBy(ownedCalls(file, "react#useState"), ({ key }) => key)].flatMap(([key, [first, ...rest]]) =>
          rest.map(({ owner, use }) => ({
            key: `${key} useState`,
            line: use.line,
            fix: (lines) => `${file.path}: ${owner} calls useState on line ${first?.use.line}, and again on ${lines}. Hold its state in one useReducer whose state is a union with a status field.`,
          })),
        ),
      ),
  },
  {
    name: "react/no-flag-state",
    find: ({ files }) =>
      files.flatMap((file) =>
        ownedCalls(file, "react#useState").flatMap(({ owner, key, use: { line, call } }) =>
          call.first !== null && FLAG_STATES.has(call.first)
            ? [{
              key: `${key} ${call.first}`,
              line,
              fix: (lines) => `${file.path}: ${owner} keeps ${call.first} in useState on ${lines}. Model the request as a status in a useReducer state union, such as { status: "loading" } | { status: "done", data }.`,
            }]
            : [],
        ),
      ),
  },
  {
    name: "react/reducer-status-union",
    async find({ root, files }) {
      const sites = files.flatMap((file) => ownedCalls(file, "react#useReducer").map(({ owner, key, use }) => ({ file: file.path, end: use.call.end, owner, key, line: use.line })));
      const shapes = await reducerStates(root, sites);
      return sites.flatMap((site) => {
        const shape = /** @type {import("./support/reducer-state.mjs").StateShape} */ (shapes.get(site));
        const statuses = shape.exact ? shape.members.map((member) => member.status) : [];
        const shared = statuses.find((status, index) => status !== null && statuses.indexOf(status) !== index);
        if (shape.exact && statuses.length >= 2 && !statuses.includes(null) && shared === undefined) return [];
        const call = `${site.file}: ${site.owner}'s useReducer on`;
        const problem = shared === undefined ? "which is not a union whose members each have a literal status" : `whose members share status "${shared}"`;
        return [{
          key: `${site.key} useReducer`,
          line: site.line,
          fix: (lines) => shape.exact
            ? `${call} ${lines} holds ${shape.members.map((member) => member.text).join(" | ")}, ${problem}. ${UNION_FIX}`
            : `${call} ${lines} ${shape.reason}, so the check cannot read its state. ${shape.fix}`,
        }];
      });
    },
  },
  {
    name: "react/no-direct-swr",
    find: ({ files, wrappers }) =>
      files.filter((file) => !wrappers.has(file.path)).flatMap((file) =>
        file.uses
          .filter((use) => use.space === "module" && use.kind === "import" && SWR.has(use.path))
          .map(({ path, line }) => ({
            key: `${file.path} ${path}`,
            line,
            fix: (lines) => `${file.path} imports ${path} on ${lines}. Import useSWR or useSWRInfinite from ${WRAPPER} of its app, copied from node_modules/@mapringg/standard/templates/swr.ts, which turns off focus and reconnect revalidation.`,
          })),
      ),
  },
];

/** @type {(lines: readonly number[]) => string} */
const linesText = (lines) => {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  return `line${sorted.length > 1 ? "s" : ""} ${sorted.join(", ")}`;
};

/** @type {import("../registry.mjs").Check} */
export default {
  name: "react",
  since: "0.12.0",
  doc: {
    enforces: "A component or hook calls `useState` at most once and never for a `loading`, `isLoading`, `error` or `isError` flag. Each `useReducer` state is a union whose members have different `status` literals. Only each React app's `src/lib/swr.ts` imports swr.",
    fix: "Hold more than one value in a `useReducer` with a status union, and use the `src/lib/swr.ts` hooks instead of swr.",
    config: [],
  },
  subject: "tree",
  moved: { "react/no-client-fetch": "client-data" },
  retired: [],
  applies: (repo) => (dependents(repo, "react").length > 0 ? { on: true } : { on: false, because: "no tracked package.json declares react" }),
  async run(repo) {
    const facts = sourceFacts(repo);
    const scope = {
      root: repo.root,
      files: facts.flatMap((file) => ("error" in file ? [] : [file])),
      wrappers: new Set(reactApps(repo).map((app) => posix.join(app, WRAPPER))),
    };
    const parseErrors = facts.flatMap((file) => ("error" in file ? [{ key: `${file.path} parse`, group: "react/parse", fix: `${file.path} does not parse, so react cannot read it: ${file.error}. Fix the syntax.` }] : []));
    return [
      ...parseErrors,
      ...(await Promise.all(RULES.map(async (rule) => {
        const problems = await rule.find(scope);
        const lines = Map.groupBy(problems, (problem) => problem.key);
        return problems.map(({ key, fix }) => ({ key, group: rule.name, fix: fix(linesText((lines.get(key) ?? []).map((problem) => problem.line))) }));
      }))).flat(),
    ];
  },
};
