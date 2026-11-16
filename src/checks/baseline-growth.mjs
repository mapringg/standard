import { git } from "../repo.mjs";

const BASELINES = /^\.standard\/baselines\/([^/]+)\.json$/;

/**
 * @param {import("../repo.mjs").Repo} repo
 * @param {string} commit
 * @returns {string[]}
 */
function rawPendingAt(repo, commit) {
  const text = repo.readAt(commit, "standard.json");
  try {
    const pending = text === null ? [] : JSON.parse(text).pending;
    return Array.isArray(pending) ? pending.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

/**
 * @param {string | null} text
 * @returns {number | null}
 */
function entries(text) {
  if (text === null) return null;
  try {
    const groups = Object.values(JSON.parse(text));
    return groups.every(Array.isArray) ? groups.reduce((sum, keys) => sum + keys.length, 0) : null;
  } catch {
    return null;
  }
}

const PACKAGE = "@mapringg/standard";

/**
 * @param {string} version
 * @returns {number[]}
 */
function parts(version) {
  return version.split(".").map(Number);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  const at = x.findIndex((part, index) => part !== y[index]);
  return at !== -1 && x[at] > y[at];
}

/**
 * How a commit installs the standard: not at all, at a version, or with a spec no version can be read from.
 * @param {import("../repo.mjs").Repo} repo
 * @param {string} commit
 * @returns {{ installed: false } | { installed: true, version: string | null }}
 */
function pinnedAt(repo, commit) {
  const text = repo.readAt(commit, "package.json");
  if (text === null) return { installed: false };
  let spec;
  try {
    const manifest = JSON.parse(text);
    spec = manifest.devDependencies?.[PACKAGE] ?? manifest.dependencies?.[PACKAGE];
  } catch {
    return { installed: true, version: null };
  }
  if (typeof spec !== "string") return { installed: false };
  return { installed: true, version: /(\d+\.\d+\.\d+)/.exec(spec)?.[1] ?? null };
}

/**
 * @param {import("../repo.mjs").Repo} repo
 * @param {string} commit
 * @param {string} path
 * @returns {boolean}
 */
function isSymlinkAt(repo, commit, path) {
  return git(repo.root, "ls-tree", commit, "--", path).startsWith("120000 ");
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "baseline-growth",
  since: "0.2.0",
  subject: "pr",
  retired: [],
  run(pr, repo, checks) {
    const base = pinnedAt(repo, pr.baseSha);
    const head = pinnedAt(repo, pr.headSha);
    const arrived = (/** @type {string} */ name) => {
      if (!base.installed) return true;
      if (!base.version || !head.installed || !head.version) return false;
      const [from, to] = [base.version, head.version];
      return checks.some(
        (check) => check.name === name && newer(check.since, from) && !newer(check.since, to),
      );
    };
    const before = rawPendingAt(repo, pr.baseSha);
    const after = rawPendingAt(repo, pr.headSha);
    const adopted = before.filter((name) => !after.includes(name));
    const findings = after
      .filter((name) => !before.includes(name) && !arrived(name))
      .map((name) => ({
        key: `pending ${name}`,
        fix: `standard.json adds "${name}" to pending. pending only shrinks: fix what ${name} finds, or start its baseline in the PR that removes it from pending.`,
      }));

    const tracked = git(repo.root, "ls-tree", "-r", "--name-only", pr.headSha, "--", ".standard");
    const guarded = ["standard.json", ...tracked.split("\n").filter(Boolean)];
    for (const path of guarded) {
      if (isSymlinkAt(repo, pr.headSha, path)) {
        findings.push({ key: path, fix: `${path} is a symlink. Make it a regular file, so the checks and this guard read the same content.` });
      }
    }

    for (const path of pr.changedFiles) {
      const check = BASELINES.exec(path)?.[1];
      if (!check || adopted.includes(check)) continue;
      const was = entries(repo.readAt(pr.baseSha, path));
      const now = repo.readAt(pr.headSha, path);
      if (now === null) continue;
      const count = entries(now);
      if (count === null) {
        findings.push({ key: path, fix: `${path} is not a baseline: an object of lists of finding keys.` });
      } else if (was === null) {
        findings.push({
          key: path,
          fix: `This PR creates ${path} with ${count} entries. A baseline starts only in the PR that removes ${check} from standard.json pending. Fix the findings instead.`,
        });
      } else if (count > was) {
        findings.push({
          key: path,
          fix: `This PR grows ${path} from ${was} to ${count} entries. A baseline only shrinks. Fix the new findings instead.`,
        });
      }
    }
    return findings;
  },
};
