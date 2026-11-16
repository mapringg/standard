import { execFileSync } from "node:child_process";

import { subjectNotes } from "./checks/support/subject-rules.mjs";

const BASE = "develop";
const GATE = "Check";
const GATE_APP = "github-actions";
const EVENT = "pull_request";
const PR_FIELDS = "number,title,state,isDraft,baseRefName,headRefOid";
const CHECK_FIELDS = ".check_runs[] | {name, head_sha, status, conclusion, started_at, app: {slug: .app.slug}, check_suite: {id: .check_suite.id}}";
const RUN_FIELDS = ".workflow_runs[] | {id, workflow_id, event, head_sha, check_suite_id, run_attempt, run_started_at, status, conclusion}";
const READY_FIELDS = '.[] | select(.event == "ready_for_review") | {created_at}';
const OUTPUT_LIMIT = 256 * 1024 * 1024;

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
 * @property {readonly [readonly WorkflowRun[], readonly WorkflowRun[]]} workflowReads
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
 * @param {readonly WorkflowRun[]} workflowRuns
 * @param {string} head
 * @param {ReadonlySet<number | undefined>} workflows
 */
function newestRun(workflowRuns, head, workflows) {
  return workflowRuns
    .filter((run) => run.event === EVENT && run.head_sha === head && workflows.has(run.workflow_id))
    .toSorted(byStart)
    .at(-1);
}

/**
 * @param {WorkflowRun | undefined} run
 */
function attempt(run) {
  return run ? `run ${run.id} attempt ${run.run_attempt} ${run.status}` : "no run";
}

/**
 * @param {string} head
 * @param {HeadRuns} runs
 * @returns {string | null} The reason to refuse.
 */
function gateRefusal(head, { checkRuns, workflowReads: [before, after], readyAt }) {
  const bySuite = new Map(after.map((run) => [run.check_suite_id, run]));
  const gates = checkRuns.filter((run) => run.name === GATE && run.app?.slug === GATE_APP && run.head_sha === head);
  const workflows = new Set(gates.map((run) => bySuite.get(run.check_suite.id)?.workflow_id));
  const newest = newestRun(after, head, workflows);
  if (!newest) {
    const found = checkRuns.length === 0 ? "no check runs" : checkRuns.map((run) => describe(run, bySuite)).join("; ");
    return `no ${GATE} run from ${GATE_APP} in a ${EVENT} run on head ${head}. Found ${found}.`;
  }
  const earlier = newestRun(before, head, workflows);
  if (attempt(earlier) !== attempt(newest)) {
    return `retry: the newest ${EVENT} run on ${head.slice(0, 7)} changed from ${attempt(earlier)} to ${attempt(newest)} while standard merge read the runs. Run standard merge again.`;
  }
  const where = `${EVENT} run ${newest.id} attempt ${newest.run_attempt}, the newest on ${head.slice(0, 7)},`;
  if (newest.status !== "completed") return `wait: ${where} is ${newest.status}.`;
  const gate = gates.find((run) => run.check_suite.id === newest.check_suite_id);
  if (!gate) return `${where} concluded ${newest.conclusion} without a ${GATE} run.`;
  if (gate.status !== "completed") return `${GATE} in ${where} is ${gate.status}.`;
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
 * @returns {string}
 */
function gh(cwd, args) {
  try {
    return execFileSync("gh", args, { cwd, encoding: "utf8", maxBuffer: OUTPUT_LIMIT, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stderr = "", message } = /** @type {Error & { stderr?: string }} */ (error);
    throw new Error(`gh ${args.join(" ")} failed. ${stderr.trim() || message}`);
  }
}

/**
 * @param {string} cwd
 * @param {string} path
 * @param {string} fields
 * @returns {any[]}
 */
function ghItems(cwd, path, fields) {
  return gh(cwd, ["api", "--paginate", "--jq", fields, `repos/{owner}/{repo}/${path}`])
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
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
  const pr = JSON.parse(gh(cwd, ["pr", "view", String(number), "--json", PR_FIELDS]));
  /** @type {{ created_at: string }[]} */
  const readyEvents = ghItems(cwd, `issues/${number}/events?per_page=100`, READY_FIELDS);
  /** @type {() => WorkflowRun[]} */
  const readWorkflowRuns = () => ghItems(cwd, `actions/runs?head_sha=${pr.headRefOid}&per_page=100`, RUN_FIELDS);
  const before = readWorkflowRuns();
  /** @type {CheckRun[]} */
  const checkRuns = ghItems(cwd, `commits/${pr.headRefOid}/check-runs?filter=latest&per_page=100`, CHECK_FIELDS);
  const after = readWorkflowRuns();
  const readyAt = readyEvents.map((event) => event.created_at).sort().at(-1) ?? null;
  const decision = mergeDecision(pr, { checkRuns, workflowReads: [before, after], readyAt }, admin);
  if (!decision.merge) {
    console.error(`standard merge: refusing #${number}, because`);
    for (const reason of decision.reasons) console.error(`  ${reason}`);
    return 1;
  }
  console.log(`standard merge: gh ${decision.args.map(quote).join(" ")}`);
  execFileSync("gh", decision.args, { cwd, stdio: "inherit" });
  return 0;
}
