import { execFileSync } from "node:child_process";

import { subjectNotes } from "./checks/support/subject-rules.mjs";

const BASE = "develop";
const GATE = "Check";
const GATE_APP = "github-actions";
const EVENT = "pull_request";
const PR_FIELDS = "number,title,state,isDraft,baseRefName,headRefOid";

export const retired = ["scripts/merge-pr.mjs", "scripts/merge-pr.test.mjs"];

/**
 * @typedef {object} MergeTarget
 * @property {number} number
 * @property {string} title
 * @property {string} state OPEN, CLOSED or MERGED.
 * @property {boolean} isDraft
 * @property {string} baseRefName
 * @property {string} headRefOid
 *
 * @typedef {object} CheckRun
 * @property {string} name
 * @property {string} head_sha
 * @property {string} status
 * @property {string | null} conclusion
 * @property {string | null} started_at
 * @property {{ slug: string } | null} app
 * @property {{ id: number }} check_suite
 *
 * @typedef {object} WorkflowRun
 * @property {number} id
 * @property {number} workflow_id
 * @property {string} event
 * @property {string} head_sha
 * @property {number} check_suite_id
 * @property {number} run_attempt
 * @property {string} run_started_at
 * @property {string} status
 * @property {string | null} conclusion
 *
 * @typedef {object} HeadRuns
 * @property {readonly CheckRun[]} checkRuns
 * @property {readonly WorkflowRun[]} workflowRuns
 * @property {string | null} readyAt
 *
 * @typedef {{ merge: true, args: string[] } | { merge: false, reasons: string[] }} Decision
 */

/**
 * @param {CheckRun} run
 * @param {ReadonlyMap<number, WorkflowRun>} bySuite
 * @returns {string}
 */
function describe(run, bySuite) {
  const state = run.status === "completed" ? `concluded ${run.conclusion}` : `is ${run.status}`;
  const event = bySuite.get(run.check_suite.id)?.event;
  const source = event ? `a ${event} run` : "no workflow run";
  return `${run.name} from ${run.app?.slug ?? "an unknown app"} on ${run.head_sha.slice(0, 7)} in ${source} ${state}`;
}

/**
 * @param {WorkflowRun} a
 * @param {WorkflowRun} b
 */
function byStart(a, b) {
  return Date.parse(a.run_started_at) - Date.parse(b.run_started_at) || a.id - b.id;
}

/**
 * @param {string} head
 * @param {HeadRuns} runs
 * @returns {string | null} The reason to refuse.
 */
function gateRefusal(head, { checkRuns, workflowRuns, readyAt }) {
  const bySuite = new Map(workflowRuns.map((run) => [run.check_suite_id, run]));
  const gates = checkRuns.filter((run) => run.name === GATE && run.app?.slug === GATE_APP && run.head_sha === head);
  const workflows = new Set(gates.map((run) => bySuite.get(run.check_suite.id)?.workflow_id));
  const newest = workflowRuns
    .filter((run) => run.event === EVENT && run.head_sha === head && workflows.has(run.workflow_id))
    .toSorted(byStart)
    .at(-1);
  if (!newest) {
    const found = checkRuns.length === 0 ? "no check runs" : checkRuns.map((run) => describe(run, bySuite)).join("; ");
    return `no ${GATE} run from ${GATE_APP} in a ${EVENT} run on head ${head}. Found ${found}.`;
  }
  const where = `${EVENT} run ${newest.id} attempt ${newest.run_attempt}, the newest on ${head.slice(0, 7)},`;
  const gate = gates.find((run) => run.check_suite.id === newest.check_suite_id);
  if (!gate && newest.status !== "completed") return `wait: ${where} is ${newest.status} and has no ${GATE} run yet.`;
  if (!gate) return `${where} concluded ${newest.conclusion} without a ${GATE} run.`;
  if (gate.status !== "completed") return `wait: ${GATE} in ${where} is ${gate.status}.`;
  if (gate.conclusion !== "success") return `${GATE} in ${where} concluded ${gate.conclusion}.`;
  if (readyAt && !(Date.parse(gate.started_at ?? "") >= Date.parse(readyAt))) {
    return `${GATE} in ${where} started at ${gate.started_at}, before the pull request left draft at ${readyAt}. Rerun ${GATE}, or add ready_for_review to on.pull_request.types.`;
  }
  return null;
}

/**
 * @param {MergeTarget} pr
 * @param {HeadRuns} runs
 * @param {boolean} admin
 * @returns {Decision}
 */
export function mergeDecision(pr, runs, admin) {
  const reasons = [];
  if (pr.state !== "OPEN") reasons.push(`it is ${pr.state.toLowerCase()}, not open.`);
  if (pr.isDraft) reasons.push("it is a draft.");
  if (pr.baseRefName !== BASE) reasons.push(`its base is ${pr.baseRefName}, not ${BASE}.`);

  const title = pr.title.replace(/ \(#\d+\)$/, "");
  const suffix = ` (#${pr.number})`;
  for (const note of subjectNotes(title, suffix)) reasons.push(`its title breaks a subject rule. ${note}`);

  const refusal = gateRefusal(pr.headRefOid, runs);
  if (refusal) reasons.push(refusal);

  if (reasons.length > 0) return { merge: false, reasons };
  return {
    merge: true,
    args: [
      "pr",
      "merge",
      String(pr.number),
      "--squash",
      "--match-head-commit",
      pr.headRefOid,
      "--subject",
      `${title}${suffix}`,
      "--body",
      "",
      ...(admin ? ["--admin"] : []),
    ],
  };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {any}
 */
function ghJson(cwd, args) {
  try {
    return JSON.parse(execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    const { stderr = "", message } = /** @type {Error & { stderr?: string }} */ (error);
    throw new Error(`gh ${args.join(" ")} failed. ${stderr.trim() || message}`);
  }
}

/**
 * @param {string} arg
 * @returns {string}
 */
function quote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * Reads the pull request, its head's runs and its events live, so a push after review cannot slip in.
 * @param {string} cwd
 * @param {number} number
 * @param {boolean} admin
 * @returns {0 | 1}
 */
export function merge(cwd, number, admin) {
  /** @type {MergeTarget} */
  const pr = ghJson(cwd, ["pr", "view", String(number), "--json", PR_FIELDS]);
  /** @type {(path: string) => any[]} */
  const pages = (path) => ghJson(cwd, ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/${path}`]);
  /** @type {CheckRun[]} */
  const checkRuns = pages(`commits/${pr.headRefOid}/check-runs?filter=latest&per_page=100`).flatMap((page) => page.check_runs);
  /** @type {WorkflowRun[]} */
  const workflowRuns = pages(`actions/runs?head_sha=${pr.headRefOid}&per_page=100`).flatMap((page) => page.workflow_runs);
  /** @type {{ event: string, created_at: string }[]} */
  const events = pages(`issues/${number}/events?per_page=100`).flat();
  const readyAt = events.filter((event) => event.event === "ready_for_review").map((event) => event.created_at).sort().at(-1) ?? null;
  const decision = mergeDecision(pr, { checkRuns, workflowRuns, readyAt }, admin);
  if (!decision.merge) {
    console.error(`standard merge: refusing #${number}, because`);
    for (const reason of decision.reasons) console.error(`  ${reason}`);
    return 1;
  }
  console.log(`standard merge: gh ${decision.args.map(quote).join(" ")}`);
  execFileSync("gh", decision.args, { cwd, stdio: "inherit" });
  return 0;
}
