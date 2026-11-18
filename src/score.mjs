import { resolve } from "node:path";

import { FILE, pendingProblem } from "./config.mjs";
import { gh } from "./github.mjs";
import { hookProblems } from "./install.mjs";
import { newer, PACKAGE, pinOf, REPOSITORY } from "./pin.mjs";
import { baselineEntries } from "./ratchet.mjs";
import { registry } from "./registry.mjs";
import { loadRepo, tracked } from "./repo.mjs";
import { settingsNotes } from "./settings.mjs";
import { PROBES } from "./wiring.mjs";

/**
 * @typedef {import("./registry.mjs").Check} Check
 * @typedef {import("./repo.mjs").Repo} Repo
 * @typedef {import("./pin.mjs").Pin} Pin
 *
 * @typedef {object} Cell
 * @property {"wiring" | "checks" | "github"} group
 * @property {string} row
 * @property {"ok" | "fail" | "unknown" | "on" | "pending" | `debt ${number}` | "absent" | "n/a"} status
 * @property {boolean | null} pass
 * @property {string[]} notes
 *
 * @typedef {object} RepoScore
 * @property {string} name
 * @property {Cell[]} cells
 * @property {number} passing
 * @property {number} total
 */

/**
 * @param {Check} check
 * @param {Repo} repo
 * @param {Pin} pin
 * @returns {Pick<Cell, "status" | "pass" | "notes">}
 */
function checkStatus(check, repo, pin) {
  if (repo.config.pending.includes(check.name)) {
    return { status: "pending", pass: false, notes: [`${FILE} pending lists it, so it does not run.`] };
  }
  /** @type {import("./registry.mjs").Applies} */
  const applies = check.subject === "commit" ? { on: true } : (check.applies?.(repo) ?? { on: true });
  if (!applies.on) return { status: "n/a", pass: null, notes: [applies.because] };
  if (pin.kind === "none") return { status: "absent", pass: false, notes: [`The repo does not install ${PACKAGE}.`] };
  if (pin.kind === "unreadable" || pin.version === null) {
    return { status: "absent", pass: false, notes: [`No version can be read from the ${PACKAGE} pin.`] };
  }
  if (newer(check.since, pin.version)) {
    return { status: "absent", pass: false, notes: [`Added in ${check.since}; the repo pins ${pin.version}.`] };
  }
  if (check.subject === "tree" && check.baseline !== false) {
    const path = `.standard/baselines/${check.name}.json`;
    const count = baselineEntries(tracked(repo, path));
    if (count) return { status: `debt ${count}`, pass: false, notes: [`${path} lists ${count} findings to fix.`] };
  }
  return { status: "on", pass: true, notes: [] };
}

/**
 * @returns {string | null} The newest release version, such as "0.4.0", or null when there is none.
 */
function latestRelease() {
  const tags = gh(process.cwd(), ["api", "--paginate", `repos/${REPOSITORY}/tags`, "--jq", ".[].name"]);
  const versions = tags.split("\n").flatMap((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag.trim())?.slice(1) ?? []);
  return versions.reduce((/** @type {string | null} */ latest, version) => (latest === null || newer(version, latest) ? version : latest), null);
}

/**
 * @param {Pin} pin
 * @param {string | null} latest
 * @returns {string[]}
 */
function currentNotes(pin, latest) {
  if (latest === null) return [`${REPOSITORY} has no v<major>.<minor>.<patch> tag to compare the pin with.`];
  if (pin.kind !== "pinned" || pin.version === null) return [`Pin ${PACKAGE} to v${latest}, the latest release.`];
  if (newer(latest, pin.version)) return [`Bump ${PACKAGE} to v${latest}, the latest release; the repo pins ${pin.version}.`];
  return [];
}

/**
 * @param {Cell["group"]} group
 * @param {string} row
 * @param {string[]} notes
 * @returns {Cell}
 */
function passOrFail(group, row, notes) {
  return { group, row, status: notes.length ? "fail" : "ok", pass: notes.length === 0, notes };
}

/**
 * @param {string} root
 * @param {Pin} pin
 * @param {string | null} latest
 * @returns {Cell[]}
 */
function githubCells(root, pin, latest) {
  const { fail, unknown } = settingsNotes(root);
  /** @type {Cell} */
  const settings =
    fail.length === 0 && unknown.length > 0
      ? { group: "github", row: "settings", status: "unknown", pass: null, notes: unknown }
      : passOrFail("github", "settings", [...fail, ...unknown]);
  return [settings, passOrFail("github", "current", currentNotes(pin, latest))];
}

/**
 * @param {string} path
 * @param {{ latest: string | null } | null} remote
 * @returns {RepoScore}
 */
function scoreRepo(path, remote) {
  const repo = loadRepo(resolve(path));
  const pin = pinOf(tracked(repo, "package.json"));
  const config = pendingProblem(repo.config, registry.map((check) => check.name));
  /** @type {Cell[]} */
  const cells = [
    ...PROBES.map((probe) => passOrFail("wiring", probe.name, probe.run(repo, registry).map((finding) => finding.fix))),
    passOrFail("wiring", "hooks", hookProblems(repo.root)),
    passOrFail("wiring", "config", config === null ? [] : [config]),
    ...registry.map((check) => ({ group: /** @type {const} */ ("checks"), row: check.name, ...checkStatus(check, repo, pin) })),
    ...(remote === null ? [] : githubCells(repo.root, pin, remote.latest)),
  ];
  const counted = cells.filter((cell) => cell.pass !== null);
  return { name: repo.name, cells, passing: counted.filter((cell) => cell.pass).length, total: counted.length };
}

/**
 * @param {string[]} paths
 * @param {boolean} remote
 * @returns {RepoScore[]}
 */
export function score(paths, remote) {
  const release = remote ? { latest: latestRelease() } : null;
  return paths.map((path) => scoreRepo(path, release));
}

/**
 * @param {RepoScore[]} scores
 * @returns {boolean}
 */
export function anyFails(scores) {
  return scores.some((repo) => repo.cells.some((cell) => cell.pass === false));
}

/**
 * @param {RepoScore[]} scores
 * @returns {string[]}
 */
export function formatScore(scores) {
  const rows = scores[0].cells;
  const width = Math.max(...rows.map((cell) => cell.row.length + 2));
  const widths = scores.map((repo) => Math.max(repo.name.length, ...repo.cells.map((cell) => cell.status.length)));
  const line = (/** @type {string} */ first, /** @type {string[]} */ cells) =>
    [first.padEnd(width), ...cells.map((cell, index) => cell.padEnd(widths[index]))].join("  ").trimEnd();

  const out = [line("", scores.map((repo) => repo.name))];
  rows.forEach((cell, index) => {
    if (cell.group !== rows[index - 1]?.group) out.push(cell.group);
    out.push(line(`  ${cell.row}`, scores.map((repo) => repo.cells[index].status)));
  });
  const notes = rows.flatMap((cell, index) => {
    const byNote = Map.groupBy(
      scores.flatMap((repo) => {
        const { status, pass, notes } = repo.cells[index];
        return notes.map((note) => ({ name: repo.name, note: pass === null ? `${status}, ${note}` : note }));
      }),
      ({ note }) => note,
    );
    return [...byNote].map(([note, repos]) => `${cell.row} in ${repos.map(({ name }) => name).join(", ")}: ${note}`);
  });
  if (notes.length) out.push("", ...notes);
  out.push("", ...scores.map((repo) => `${repo.name}: ${repo.passing} of ${repo.total} pass`));
  return out;
}
