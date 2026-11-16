import { parse } from "yaml";

import { FILE } from "./config.mjs";
import { retired as mergeRetired } from "./merge.mjs";
import { installedVersion, isExact, PACKAGE, pinOf, REPOSITORY, VERSION } from "./pin.mjs";
import { tracked } from "./repo.mjs";

/**
 * @typedef {import("./registry.mjs").Finding} Finding
 * @typedef {import("./repo.mjs").Repo} Repo
 *
 * @typedef {object} Owner
 * @property {string} name
 * @property {readonly string[]} retired
 * @property {true} [command]
 *
 * @typedef {object} Probe
 * @property {string} name
 * @property {(repo: Repo, checks: readonly Owner[]) => Finding[]} run
 */

/** @type {readonly Owner[]} */
const COMMANDS = [{ name: "standard merge", retired: mergeRetired, command: /** @type {const} */ (true) }];

const EXAMPLE_PIN = `github:${REPOSITORY}#v${VERSION}`;

/**
 * @param {string[]} names
 * @returns {string}
 */
function list(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * @param {Owner} owner
 * @returns {string}
 */
function ownerName(owner) {
  return owner.command ? owner.name : `the ${owner.name} check`;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

const GATES = ["if", "continue-on-error"];

const COMMAND = /^(?:pnpm exec |pnpm |npx )?standard check$/;

const PR_ACTIVITY = ["opened", "synchronize", "reopened"];

const NO_WORKFLOW = `Add a workflow under .github/workflows that runs on pull_request, with a job named Check that runs "pnpm exec standard check" after actions/checkout with fetch-depth: 0.`;

/**
 * @typedef {{ stage: number, fix: string }} Miss
 */

/**
 * @param {Record<string, unknown> | null} step
 * @returns {step is Record<string, unknown>}
 */
function ungated(step) {
  return step !== null && !GATES.some((key) => key in step);
}

/**
 * @param {Record<string, unknown>} step
 * @returns {boolean}
 */
function checksOutFullHistory(step) {
  return (
    typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@") &&
    [0, "0"].includes(/** @type {number | string} */ (record(step.with)?.["fetch-depth"]))
  );
}

/**
 * @param {Record<string, unknown>} step
 * @returns {boolean}
 */
function runsStandardCheck(step) {
  return typeof step.run === "string" && COMMAND.test(step.run.trim()) && !("shell" in step) && !setsGithubEnv(step);
}

/**
 * @param {Record<string, unknown>} scope
 * @returns {boolean}
 */
function setsGithubEnv(scope) {
  return Object.keys(record(scope.env) ?? {}).some((key) => key.startsWith("GITHUB_"));
}

/**
 * @param {Record<string, unknown>} scope
 * @returns {boolean}
 */
function setsShell(scope) {
  return record(record(scope.defaults)?.run)?.shell !== undefined;
}

/**
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function branchPattern(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*" && pattern[index + 2] === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index++;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?" || char === "+") source += char;
    else if (char === "[") {
      const end = pattern.indexOf("]", index);
      if (end === -1) return null;
      source += pattern.slice(index, end + 1);
      index = end;
    } else source += char.replace(/[.\\^$(){}|]/g, "\\$&");
  }
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} patterns
 * @param {string} branch
 * @returns {boolean | null}
 */
function matchesBranch(patterns, branch) {
  if (!Array.isArray(patterns)) patterns = [patterns];
  let matched = false;
  for (const raw of /** @type {unknown[]} */ (patterns)) {
    if (typeof raw !== "string") return null;
    const negated = raw.startsWith("!");
    const regex = branchPattern(negated ? raw.slice(1) : raw);
    if (regex === null) return null;
    if (regex.test(branch)) matched = !negated;
  }
  return matched;
}

/**
 * @param {unknown} on
 * @returns {"none" | "yes" | string}
 */
function pullRequestTrigger(on) {
  if (on === "pull_request" || (Array.isArray(on) && on.includes("pull_request"))) return "yes";
  const events = record(on);
  if (events === null || !Object.hasOwn(events, "pull_request")) return "none";
  if (events.pull_request !== null && record(events.pull_request) === null) {
    return "make on.pull_request a mapping of filters or leave it empty";
  }
  const filters = record(events.pull_request) ?? {};
  const paths = ["paths", "paths-ignore"].filter((key) => key in filters);
  if (paths.length > 0) return `remove ${list(paths.map((key) => `on.pull_request.${key}`))}, since a pull request that skips Check cannot merge`;
  if ("branches" in filters && "branches-ignore" in filters) return "keep only one of on.pull_request.branches and branches-ignore";
  if ("branches" in filters && matchesBranch(filters.branches, "develop") !== true) {
    return "make on.pull_request.branches match develop, or remove the filter";
  }
  if ("branches-ignore" in filters && matchesBranch(filters["branches-ignore"], "develop") !== false) {
    return "make on.pull_request.branches-ignore leave develop out, or remove it";
  }
  const types = filters.types;
  if (types !== undefined && !PR_ACTIVITY.every((type) => (Array.isArray(types) ? types : [types]).includes(type))) {
    return `make on.pull_request.types include ${list(PR_ACTIVITY)}, or remove it`;
  }
  return "yes";
}

/**
 * @param {string} path
 * @param {string} id
 * @param {Record<string, unknown>} job
 * @returns {Miss | null}
 */
function checkJobMiss(path, id, job) {
  const gates = [
    ...GATES.filter((key) => key in job),
    ...(record(job.strategy)?.matrix === undefined ? [] : ["strategy.matrix"]),
    ...(setsShell(job) ? ["defaults.run.shell"] : []),
    ...(setsGithubEnv(job) ? ["the GITHUB_ variables in env"] : []),
  ];
  if (gates.length > 0) {
    return { stage: 4, fix: `Remove ${list(gates)} from job ${id} in ${path}, so Check runs on every pull request and fails when the checks fail.` };
  }
  const steps = Array.isArray(job.steps) ? job.steps.map(record) : [];
  const checkout = steps.findIndex((step) => ungated(step) && checksOutFullHistory(step));
  if (checkout === -1) {
    return { stage: 5, fix: `Add a step to job ${id} in ${path} that uses actions/checkout with fetch-depth: 0 and no if or continue-on-error, so the commit checks see the pull request's history.` };
  }
  if (steps.slice(checkout + 1).some((step) => ungated(step) && runsStandardCheck(step))) return null;
  return {
    stage: 6,
    fix: `Add a step after actions/checkout in job ${id} in ${path} whose run is exactly "pnpm exec standard check", with no other commands, arguments, shell, GITHUB_ variables in env, if or continue-on-error.`,
  };
}

/**
 * @param {string} path
 * @param {string} text
 * @returns {Miss | null}
 */
function workflowMiss(path, text) {
  let parsed;
  try {
    parsed = parse(text);
  } catch (error) {
    const reason = /** @type {Error} */ (error).message.split("\n")[0].replace(/:$/, "");
    return { stage: 1, fix: `Make ${path} valid YAML. ${reason}.` };
  }
  const workflow = record(parsed) ?? {};
  const trigger = pullRequestTrigger(workflow.on);
  if (trigger === "none") return { stage: 0, fix: NO_WORKFLOW };
  if (trigger !== "yes") {
    return { stage: 2, fix: `In ${path}, ${trigger}, so the workflow runs on every pull request to develop.` };
  }
  if (setsShell(workflow) || setsGithubEnv(workflow)) {
    return { stage: 2, fix: `Remove defaults.run.shell and GITHUB_ variables from the top level of ${path}, so standard check runs as written and sees the real event.` };
  }
  const misses = Object.entries(record(workflow.jobs) ?? {}).flatMap(([id, value]) => {
    const job = record(value) ?? {};
    return (job.name ?? id) === "Check" ? [checkJobMiss(path, id, job)] : [];
  });
  if (misses.length === 0) {
    return { stage: 3, fix: `Add a job named Check to ${path}, with name: Check, since standard merge waits for a check run named Check.` };
  }
  if (misses.includes(null)) return null;
  return /** @type {Miss[]} */ (misses).reduce((best, miss) => (miss.stage > best.stage ? miss : best));
}

/** @type {readonly Probe[]} */
export const PROBES = [
  {
    name: "retired",
    run(repo, checks) {
      const pending = (/** @type {Owner} */ owner) =>
        !owner.command && repo.config.pending.includes(owner.name);
      const owners = [...checks, ...COMMANDS];
      const files = new Set(repo.files());
      const paths = [...new Set(owners.flatMap((owner) => owner.retired))].filter((path) => files.has(path));
      return paths.flatMap((path) => {
        const listing = owners.filter((owner) => owner.retired.includes(path));
        if (listing.some(pending)) return [];
        const names = listing.map(ownerName);
        return [{ key: path, fix: `Delete ${path}, which ${list(names)} ${names.length === 1 ? "replaces" : "replace"}.` }];
      });
    },
  },
  {
    name: "ci",
    run(repo) {
      const misses = repo
        .files(".github/workflows/*")
        .filter((path) => /\.ya?ml$/.test(path))
        .map((path) => workflowMiss(path, repo.read(path)));
      if (misses.includes(null)) return [];
      const { fix } = /** @type {Miss[]} */ (misses).reduce((best, miss) => (miss.stage > best.stage ? miss : best), {
        stage: -1,
        fix: NO_WORKFLOW,
      });
      return [{ key: "ci", fix }];
    },
  },
  {
    name: "pin",
    run(repo) {
      const manifest = tracked(repo, "package.json");
      const pin = pinOf(manifest);
      if (manifest === null) {
        return [{ key: "pin", fix: `Add a package.json whose devDependencies pin ${PACKAGE} to "${EXAMPLE_PIN}".` }];
      }
      if (pin.kind === "none") return [{ key: "pin", fix: `Add ${PACKAGE} to devDependencies in package.json at "${EXAMPLE_PIN}".` }];
      if (pin.kind === "unreadable") return [{ key: "pin", fix: "Make package.json valid JSON, so the pin can be read." }];
      if (isExact(pin.spec)) return [];
      return [{ key: "pin", fix: `Pin ${PACKAGE} to an exact version or tag such as "${EXAMPLE_PIN}" in place of "${pin.spec}", so every clone runs the same checks.` }];
    },
  },
  {
    name: "installed",
    run(repo) {
      const pin = pinOf(tracked(repo, "package.json"));
      if (pin.kind !== "pinned" || !isExact(pin.spec)) return [];
      const installed = installedVersion(repo.root);
      if (installed === pin.version) return [];
      const now = installed === null ? "node_modules" : `the installed ${installed}`;
      return [{ key: "installed", fix: `Run pnpm install, so ${now} becomes the ${PACKAGE} ${pin.version} that package.json pins.` }];
    },
  },
  {
    name: "prepare",
    run(repo) {
      let prepare;
      try {
        prepare = JSON.parse(tracked(repo, "package.json") ?? "{}").scripts?.prepare;
      } catch {
        prepare = undefined;
      }
      if (typeof prepare === "string" && /^(?:pnpm exec )?standard install(?:$| && )/.test(prepare.trim())) return [];
      const now = typeof prepare === "string" ? `, which now runs "${prepare}"` : "";
      return [{ key: "prepare", fix: `Make package.json scripts.prepare start with "standard install"${now}, chaining anything else after it with &&, so every install writes the hooks.` }];
    },
  },
  {
    name: "config-file",
    run(repo) {
      if (tracked(repo, FILE) !== null) return [];
      return [{ key: FILE, fix: `Commit ${FILE}, even as {}, so the hooks know this repository uses the standard.` }];
    },
  },
  {
    name: "claude-md",
    run(repo) {
      const text = tracked(repo, "CLAUDE.md");
      if (text === null || text === "@AGENTS.md\n") return [];
      return [{ key: "CLAUDE.md", fix: "Make CLAUDE.md exactly \"@AGENTS.md\" and a newline, so agents read one instructions file." }];
    },
  },
];
