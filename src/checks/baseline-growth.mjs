import { FILE } from "../config.mjs";
import { newer, pinOf } from "../pin.mjs";
import { baselineEntries } from "../ratchet.mjs";
import { git } from "../repo.mjs";

const BASELINES = /^\.standard\/baselines\/([^/]+)\.json$/;

/**
 * @param {import("../repo.mjs").Repo} repo
 * @param {string} commit
 * @returns {string[]}
 */
function rawPendingAt(repo, commit) {
  const text = repo.readAt(commit, FILE) ?? repo.readAt(commit, "standard.json");
  try {
    const pending = text === null ? [] : JSON.parse(text).pending;
    return Array.isArray(pending) ? pending.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
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
  doc: {
    enforces: "A pull request does not add a check to `pending` or create or grow a baseline, and `.standard` tracks no symlink. The pull request that removes a check from `pending` may start its baseline. A pin bump may add the checks its new version introduced, and the pull request that first installs the standard may add any.",
    fix: "Fix the new findings instead of recording them.",
    config: ["pending"],
  },
  subject: "pr",
  retired: [],
  run(pr, repo, checks) {
    const base = pinOf(repo.readAt(pr.baseSha, "package.json"));
    const head = pinOf(repo.readAt(pr.headSha, "package.json"));
    const arrived = (/** @type {string} */ name) => {
      if (base.kind === "none") return true;
      if (base.kind !== "pinned" || head.kind !== "pinned" || !base.version || !head.version) return false;
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
        fix: `${FILE} adds "${name}" to pending. pending only shrinks: fix what ${name} finds, or start its baseline in the PR that removes it from pending.`,
      }));

    const tracked = git(repo.root, "ls-tree", "-r", "--name-only", pr.headSha, "--", ".standard");
    for (const path of tracked.split("\n").filter(Boolean)) {
      if (isSymlinkAt(repo, pr.headSha, path)) {
        findings.push({ key: path, fix: `${path} is a symlink. Make it a regular file, so the checks and this guard read the same content.` });
      }
    }

    for (const path of pr.changedFiles) {
      const check = BASELINES.exec(path)?.[1];
      if (!check || adopted.includes(check)) continue;
      const was = baselineEntries(repo.readAt(pr.baseSha, path));
      const now = repo.readAt(pr.headSha, path);
      if (now === null) continue;
      const count = baselineEntries(now);
      if (count === null) {
        findings.push({ key: path, fix: `${path} is not a baseline: an object of lists of finding keys.` });
      } else if (was === null) {
        findings.push({
          key: path,
          fix: `This PR creates ${path} with ${count} entries. A baseline starts only in the PR that removes ${check} from ${FILE} pending. Fix the findings instead.`,
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
