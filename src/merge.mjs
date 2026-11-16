import { execFileSync } from "node:child_process";

import { subjectNotes } from "./checks/support/subject-rules.mjs";

const BASE = "develop";
const GATE = "Check";
const GATE_APP = "github-actions";
const PR_FIELDS = "number,title,state,isDraft,baseRefName,headRefOid";

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
 * @property {{ slug: string } | null} app
 *
 * @typedef {{ merge: true, args: string[] } | { merge: false, reasons: string[] }} Decision
 */

/**
 * @param {CheckRun} run
 * @returns {string}
 */
function describe(run) {
  const state = run.status === "completed" ? `concluded ${run.conclusion}` : `is ${run.status}`;
  return `${run.name} from ${run.app?.slug ?? "an unknown app"} on ${run.head_sha.slice(0, 7)} ${state}`;
}

/**
 * @param {MergeTarget} pr
 * @param {readonly CheckRun[]} checkRuns
 * @param {boolean} admin
 * @returns {Decision}
 */
export function mergeDecision(pr, checkRuns, admin) {
  const reasons = [];
  if (pr.state !== "OPEN") reasons.push(`it is ${pr.state.toLowerCase()}, not open.`);
  if (pr.isDraft) reasons.push("it is a draft.");
  if (pr.baseRefName !== BASE) reasons.push(`its base is ${pr.baseRefName}, not ${BASE}.`);

  const title = pr.title.replace(/ \(#\d+\)$/, "");
  const suffix = ` (#${pr.number})`;
  for (const note of subjectNotes(title, suffix)) reasons.push(`its title breaks a subject rule. ${note}`);

  const gates = checkRuns.filter(
    (run) => run.name === GATE && run.app?.slug === GATE_APP && run.head_sha === pr.headRefOid,
  );
  if (gates.length === 0) {
    const found = checkRuns.length === 0 ? "no check runs" : checkRuns.map(describe).join("; ");
    reasons.push(`no ${GATE} run from ${GATE_APP} on head ${pr.headRefOid}. Found ${found}.`);
  }
  for (const run of gates) {
    if (run.status !== "completed" || run.conclusion !== "success") reasons.push(`${describe(run)}.`);
  }

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
 * Reads the pull request and its head's check runs live, so a push after review cannot slip in.
 * @param {string} cwd
 * @param {number} number
 * @param {boolean} admin
 * @returns {0 | 1}
 */
export function merge(cwd, number, admin) {
  /** @type {MergeTarget} */
  const pr = ghJson(cwd, ["pr", "view", String(number), "--json", PR_FIELDS]);
  /** @type {{ check_runs: CheckRun[] }[]} */
  const pages = ghJson(cwd, [
    "api",
    "--paginate",
    "--slurp",
    `repos/{owner}/{repo}/commits/${pr.headRefOid}/check-runs?per_page=100`,
  ]);
  const decision = mergeDecision(pr, pages.flatMap((page) => page.check_runs), admin);
  if (!decision.merge) {
    console.error(`standard merge: refusing #${number}, because`);
    for (const reason of decision.reasons) console.error(`  ${reason}`);
    return 1;
  }
  console.log(`standard merge: gh ${decision.args.map(quote).join(" ")}`);
  execFileSync("gh", decision.args, { cwd, stdio: "inherit" });
  return 0;
}
