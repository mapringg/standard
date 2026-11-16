import { gh, GhError } from "./github.mjs";

/**
 * @typedef {object} Rule One active rule from GET repos/{owner}/{repo}/rules/branches/{branch}.
 * @property {string} type
 * @property {number} [ruleset_id]
 * @property {{ allowed_merge_methods?: string[] }} [parameters]
 *
 * @typedef {object} Classic The classic branch protection of one branch.
 * @property {{ dismiss_stale_reviews: boolean, require_code_owner_reviews: boolean }} [required_pull_request_reviews]
 * @property {{ enabled: boolean }} [allow_deletions]
 * @property {{ enabled: boolean }} [allow_force_pushes]
 * @typedef {{ unreadable: string }} Unreadable
 *
 * @typedef {object} BranchExpectation
 * @property {"develop" | "main"} branch
 * @property {string} rule The rule type an active ruleset must have on the branch.
 * @property {string} want
 * @property {(protection: Classic) => boolean} classic Whether classic protection meets it instead.
 *
 * @typedef {object} SettingsNotes
 * @property {string[]} fail One line per setting that drifted, or why a response could not be parsed.
 * @property {string[]} unknown One line per setting the token cannot read.
 */

/** @type {Record<string, string | boolean>} */
const REPO = {
  default_branch: "develop",
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "BLANK",
  delete_branch_on_merge: true,
};

const SQUASH_FORMAT = ["squash_merge_commit_title", "squash_merge_commit_message"];
const ALL_METHODS = ["merge", "squash", "rebase"];

/** @type {BranchExpectation[]} */
const BRANCH = [
  {
    branch: "develop",
    rule: "pull_request",
    want: "an active ruleset or classic protection that requires a pull request",
    classic: (protection) => protection.required_pull_request_reviews !== undefined,
  },
  {
    branch: "main",
    rule: "deletion",
    want: "an active ruleset that blocks deletion",
    classic: (protection) => protection.allow_deletions?.enabled === false,
  },
  {
    branch: "main",
    rule: "non_fast_forward",
    want: "an active ruleset that blocks force-push",
    classic: (protection) => protection.allow_force_pushes?.enabled === false,
  },
];

/** @type {Record<string, object>} */
const NEW_RULE = {
  pull_request: {
    type: "pull_request",
    parameters: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      allowed_merge_methods: ["squash"],
    },
  },
  deletion: { type: "deletion" },
  non_fast_forward: { type: "non_fast_forward" },
};

class Unparseable extends Error {}

/**
 * @param {string} text
 * @param {string} path
 * @param {(value: any) => boolean} valid
 * @returns {any} The value, once `valid` accepts it.
 */
function parse(text, path, valid) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Unparseable(`gh api ${path} printed output that is not JSON, so the settings cannot be checked.`);
  }
  if (!valid(value)) throw new Unparseable(`gh api ${path} printed JSON of an unexpected shape, so the settings cannot be checked.`);
  return value;
}

/** @param {unknown} value */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {any} parameters */
const isPullRequestParameters = (parameters) =>
  isObject(parameters) &&
  (parameters.allowed_merge_methods === undefined ||
    (Array.isArray(parameters.allowed_merge_methods) &&
      parameters.allowed_merge_methods.every((/** @type {unknown} */ method) => typeof method === "string" && ALL_METHODS.includes(method))));

/** @param {any} rule */
const isRule = (rule) =>
  isObject(rule) &&
  typeof rule.type === "string" &&
  (rule.type !== "pull_request" || (Number.isInteger(rule.ruleset_id) && isPullRequestParameters(rule.parameters)));

/** @param {any} flag */
const isFlag = (flag) => flag === undefined || (isObject(flag) && typeof flag.enabled === "boolean");

/** @param {any} reviews */
const isReviews = (reviews) =>
  reviews === undefined ||
  (isObject(reviews) && typeof reviews.dismiss_stale_reviews === "boolean" && typeof reviews.require_code_owner_reviews === "boolean");

/** @param {any} protection */
const isClassic = (protection) =>
  isObject(protection) &&
  isFlag(protection.allow_deletions) &&
  isFlag(protection.allow_force_pushes) &&
  isReviews(protection.required_pull_request_reviews);

/**
 * @param {unknown} error
 * @param {string} path
 * @returns {Unreadable}
 */
function unreadable(error, path) {
  if (error instanceof GhError && (error.status === 403 || error.status === 404)) {
    return { unreadable: `gh api ${path} returned "${error.detail}".` };
  }
  throw error;
}

/**
 * @param {string} root
 * @param {string} branch
 * @returns {Rule[] | Unreadable}
 */
function readRules(root, branch) {
  const path = `repos/{owner}/{repo}/rules/branches/${branch}`;
  let text;
  try {
    text = gh(root, ["api", "--paginate", "--slurp", path]);
  } catch (error) {
    return unreadable(error, path);
  }
  /** @type {Rule[][]} */
  const pages = parse(text, path, (value) => Array.isArray(value) && value.every((page) => Array.isArray(page) && page.every(isRule)));
  return pages.flat();
}

/**
 * @param {string} root
 * @param {string} branch
 * @returns {Classic | null | Unreadable} Null when the branch has no classic protection.
 */
function readClassic(root, branch) {
  const path = `repos/{owner}/{repo}/branches/${branch}/protection`;
  let text;
  try {
    text = gh(root, ["api", path]);
  } catch (error) {
    if (error instanceof GhError && error.status === 404 && /Branch not (protected|found)/.test(error.detail)) return null;
    return unreadable(error, path);
  }
  return parse(text, path, isClassic);
}

/**
 * @template T
 * @param {(branch: string) => T} read
 * @returns {(branch: string) => T}
 */
function once(read) {
  /** @type {Map<string, T>} */
  const seen = new Map();
  return (branch) => {
    if (!seen.has(branch)) seen.set(branch, read(branch));
    return /** @type {T} */ (seen.get(branch));
  };
}

/**
 * @param {string} repository owner/name
 * @param {string} field
 */
function patchCommand(repository, field) {
  const fields = SQUASH_FORMAT.includes(field) ? SQUASH_FORMAT : [field];
  const flags = fields.map((name) => `${typeof REPO[name] === "string" ? "-f" : "-F"} ${name}=${REPO[name]}`);
  return `gh api -X PATCH repos/${repository} ${flags.join(" ")}`;
}

/**
 * @param {string} repository owner/name
 * @param {BranchExpectation} expectation
 */
function rulesetCommand(repository, { branch, rule }) {
  const body = {
    name: `standard ${branch} ${rule}`,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
    rules: [NEW_RULE[rule]],
  };
  return `echo '${JSON.stringify(body)}' | gh api -X POST repos/${repository}/rulesets --input -`;
}

/**
 * @param {Rule[]} rules
 * @returns {string[]}
 */
function allowedMethods(rules) {
  return rules
    .map((rule) => rule.parameters?.allowed_merge_methods ?? ALL_METHODS)
    .reduce((allowed, methods) => allowed.filter((method) => methods.includes(method)));
}

/**
 * @param {string} root
 * @returns {SettingsNotes}
 */
function evaluate(root) {
  /** @type {Record<string, unknown> & { full_name: string }} */
  const settings = parse(gh(root, ["api", "repos/{owner}/{repo}"]), "repos/{owner}/{repo}", (value) => isObject(value) && typeof value.full_name === "string");
  const repository = settings.full_name;
  const fail = Object.entries(REPO)
    .filter(([field, value]) => settings[field] !== value)
    .map(([field, value]) => `${field} is ${JSON.stringify(settings[field])}; expected ${JSON.stringify(value)}. Fix: ${patchCommand(repository, field)}`);
  /** @type {string[]} */
  const unknown = [];
  const rules = once((branch) => readRules(root, branch));
  const classic = once((branch) => readClassic(root, branch));

  for (const expectation of BRANCH) {
    const { branch, rule, want } = expectation;
    const active = rules(branch);
    if (Array.isArray(active) && active.some((found) => found.type === rule)) continue;
    const protection = classic(branch);
    if (protection !== null && !("unreadable" in protection) && expectation.classic(protection)) continue;
    const reasons = [active, protection].flatMap((read) => (read !== null && "unreadable" in read ? [read.unreadable] : []));
    if (reasons.length > 0) unknown.push(`${branch} ${rule} rule is unknown; ${reasons.join(" ")}`);
    else fail.push(`${branch} ${rule} rule is missing; expected ${want}. Fix: ${rulesetCommand(repository, expectation)}`);
  }

  const develop = rules("develop");
  if (!Array.isArray(develop)) {
    unknown.push(`develop allowed_merge_methods is unknown; ${develop.unreadable}`);
    return { fail, unknown };
  }
  const pullRequest = develop.filter((rule) => rule.type === "pull_request");
  if (pullRequest.length > 0) {
    const allowed = allowedMethods(pullRequest);
    if (allowed.length !== 1 || allowed[0] !== "squash") {
      const pages = [...new Set(pullRequest.map((rule) => rule.ruleset_id))].map(
        (id) => `https://github.com/${repository}/settings/rules/${id}`,
      );
      fail.push(`develop allowed_merge_methods is ${JSON.stringify(allowed)}; expected ["squash"]. Fix: ${pages.join(" ")}`);
    }
  }
  return { fail, unknown };
}

/**
 * @param {string} root
 * @returns {SettingsNotes}
 */
export function settingsNotes(root) {
  try {
    return evaluate(root);
  } catch (error) {
    if (error instanceof Unparseable) return { fail: [error.message], unknown: [] };
    throw error;
  }
}
