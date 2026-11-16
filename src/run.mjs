import { join } from "node:path";

import { pendingProblem } from "./config.mjs";
import { ratchet } from "./ratchet.mjs";

/**
 * @typedef {import("./registry.mjs").Check} Check
 * @typedef {import("./registry.mjs").Finding} Finding
 * @typedef {import("./repo.mjs").Repo} Repo
 * @typedef {import("./subjects.mjs").Subjects} Scope
 *
 * @typedef {{ check: string, outcome: "pending" }
 *   | { check: string, outcome: "skipped", because: string }
 *   | { check: string, outcome: "ran", failed: boolean, findings: Finding[], message: string }} Result
 */

const BASELINES = ".standard/baselines";

/**
 * @param {Check} check
 * @param {Repo} repo
 * @param {Scope} scope
 * @param {import("./ratchet.mjs").Mode} mode
 * @param {Check[]} checks
 * @returns {Promise<Result>}
 */
async function runCheck(check, repo, scope, mode, checks) {
  const name = check.name;
  if (repo.config.pending.includes(name)) return { check: name, outcome: "pending" };
  switch (check.subject) {
    case "commit": {
      const { commits } = scope;
      if (commits === null) {
        return { check: name, outcome: "skipped", because: "this run has no commits to check" };
      }
      if (commits.length === 0) {
        return {
          check: name,
          outcome: "ran",
          failed: true,
          findings: [],
          message: "Read no commits, so nothing was checked.",
        };
      }
      const findings = commits.flatMap((commit) => check.run(commit, repo));
      return {
        check: name,
        outcome: "ran",
        failed: findings.some((finding) => !finding.advisory),
        findings,
        message: findings.length === 0 ? `OK (${commits.length} commit(s))` : "",
      };
    }
    case "pr": {
      const applies = check.applies?.(repo) ?? { on: true };
      if (!applies.on) return { check: name, outcome: "skipped", because: applies.because };
      if (scope.pr === null) {
        return { check: name, outcome: "skipped", because: "this run has no pull request to check" };
      }
      const findings = await check.run(scope.pr, repo, checks);
      return {
        check: name,
        outcome: "ran",
        failed: findings.some((finding) => !finding.advisory),
        findings,
        message: check.summary?.(scope.pr) ?? (findings.length === 0 ? `OK (#${scope.pr.number})` : ""),
      };
    }
    case "tree": {
      const applies = check.applies(repo);
      if (!applies.on) return { check: name, outcome: "skipped", because: applies.because };
      const findings = await check.run(repo, checks);
      if (check.baseline === false) {
        return { check: name, outcome: "ran", failed: findings.length > 0, findings, message: findings.length === 0 ? "OK" : "" };
      }
      const shown = `${BASELINES}/${name}.json`;
      const verdict = ratchet({ check: name, path: join(repo.root, shown), shown, findings, mode });
      return { check: name, outcome: "ran", findings: [], ...verdict };
    }
  }
}

/**
 * @param {object} input
 * @param {Check[]} input.checks
 * @param {Repo} input.repo
 * @param {Scope} input.scope
 * @param {string[]} [input.names] Run only these checks. Empty runs every check.
 * @param {import("./ratchet.mjs").Mode} [input.mode]
 * @returns {Promise<Result[]>}
 */
export async function run({ checks, repo, scope, names = [], mode = "check" }) {
  const known = checks.map((check) => check.name);
  const problem = pendingProblem(repo.config, known);
  if (problem) throw new Error(problem);
  const unknown = names.find((name) => !known.includes(name));
  if (unknown) {
    throw new Error(`standard check names "${unknown}", which is not a check in this version. Checks: ${known.join(", ")}.`);
  }
  const selected = names.length > 0 ? checks.filter((check) => names.includes(check.name)) : checks;
  if (mode !== "check" && (selected.length !== 1 || selected[0].subject !== "tree")) {
    throw new Error(
      `--${mode} changes one baseline, so name exactly one tree check: standard check <name> --${mode}.`,
    );
  }
  if (mode !== "check" && selected[0].subject === "tree" && selected[0].baseline === false) {
    throw new Error(`${selected[0].name} allows no findings, so it has no baseline for --${mode}. Fix what it finds.`);
  }
  return Promise.all(selected.map((check) => runCheck(check, repo, scope, mode, checks)));
}

/**
 * @param {Result[]} results
 * @returns {boolean}
 */
export function failed(results) {
  return results.some((result) => result.outcome === "ran" && result.failed);
}

/**
 * GitHub reads a workflow command up to the first raw newline, so the message is percent-encoded.
 * @param {"error" | "warning"} level
 * @param {string} check
 * @param {string} text
 */
function annotation(level, check, text) {
  const message = text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return `::${level} title=${check}::${message}`;
}

/**
 * @param {Result[]} results
 * @param {boolean} annotate Print GitHub workflow commands, so findings show on the pull request.
 * @returns {string[]}
 */
export function report(results, annotate) {
  return results.flatMap((result) => {
    const { check } = result;
    if (result.outcome === "pending") return [`${check}: pending in standard.json, so it did not run`];
    if (result.outcome === "skipped") return [`${check}: skipped, ${result.because}`];
    const lines = result.findings.map(({ key, fix, advisory }) => {
      if (annotate) return annotation(advisory ? "warning" : "error", check, `${key}: ${fix}`);
      return `${check}: ${advisory ? "warning: " : ""}${key}: ${fix}`;
    });
    if (result.message) {
      lines.push(
        annotate && result.failed
          ? annotation("error", check, result.message)
          : `${check}: ${result.message}`,
      );
    }
    return lines;
  });
}
