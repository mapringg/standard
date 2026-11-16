import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @typedef {import("./registry.mjs").Finding} Finding
 * Finding keys under their group, one entry per occurrence. A baseline lists the findings that
 * existed when the check was turned on, and it only shrinks.
 * @typedef {Record<string, string[]>} Baseline
 * @typedef {"check" | "init" | "write" | "prune"} Mode
 */

/**
 * @param {string | null} baseline
 * @returns {number | null}
 */
export function baselineEntries(baseline) {
  if (baseline === null) return null;
  try {
    const groups = Object.values(JSON.parse(baseline));
    return groups.every(Array.isArray) ? groups.reduce((sum, keys) => sum + keys.length, 0) : null;
  } catch {
    return null;
  }
}

/**
 * @param {Iterable<string>} keys
 * @returns {Map<string, number>}
 */
function countKeys(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/**
 * @param {Map<string, number>} found
 * @param {Map<string, number>} allowed
 */
function compareCounts(found, allowed) {
  const added = [];
  const stale = [];
  const kept = new Map();
  for (const [key, count] of found) {
    if (count > (allowed.get(key) ?? 0)) added.push(key);
  }
  for (const [key, limit] of allowed) {
    const count = found.get(key) ?? 0;
    if (count < limit) stale.push({ key, found: count });
    if (Math.min(count, limit) > 0) kept.set(key, Math.min(count, limit));
  }
  return {
    added: added.sort((a, b) => a.localeCompare(b)),
    stale: stale.sort((a, b) => a.key.localeCompare(b.key)),
    kept,
  };
}

/**
 * @param {Map<string, number>} counts
 * @param {Map<string, string>} groups
 * @returns {Baseline | null}
 */
function toBaseline(counts, groups) {
  if (counts.size === 0) return null;
  /** @type {Baseline} */
  const baseline = {};
  const group = (/** @type {string} */ key) => /** @type {string} */ (groups.get(key));
  const entries = [...counts].sort(
    ([a], [b]) => group(a).localeCompare(group(b)) || a.localeCompare(b),
  );
  for (const [key, count] of entries) {
    const keys = (baseline[group(key)] ??= []);
    for (let index = 0; index < count; index++) keys.push(key);
  }
  return baseline;
}

/**
 * @param {Map<string, number>} counts
 */
function total(counts) {
  let sum = 0;
  for (const count of counts.values()) sum += count;
  return sum;
}

/**
 * @param {object} input
 * @param {string} input.check
 * @param {string} input.shown The baseline's path as the user reads it.
 * @param {Finding[]} input.findings
 * @param {Baseline | null} input.baseline Null when the file does not exist.
 * @param {Mode} input.mode
 * @returns {{ failed: boolean, lines: string[], write?: Baseline | null }} `write` is the baseline to store; null deletes the file.
 */
function verdict({ check, shown, findings, baseline, mode }) {
  const fixes = new Map();
  const groups = new Map();
  for (const finding of findings) {
    if (!fixes.has(finding.key)) fixes.set(finding.key, finding.fix);
    if (!groups.has(finding.key)) groups.set(finding.key, finding.group ?? check);
  }
  const allowedKeys = [];
  for (const [group, keys] of Object.entries(baseline ?? {})) {
    for (const key of keys) {
      allowedKeys.push(key);
      groups.set(key, group);
    }
  }
  const found = countKeys(findings.map((finding) => finding.key));
  const allowed = countKeys(allowedKeys);
  const { added, stale, kept } = compareCounts(found, allowed);
  const fixLines = added.map((key) => `  ${fixes.get(key)}`);

  if (mode === "init") {
    if (baseline) {
      return {
        failed: true,
        lines: [
          `${shown} already exists. --init only starts the baseline of a new check. After a rename, use --write.`,
        ],
      };
    }
    return {
      failed: false,
      lines: [
        found.size === 0
          ? "no findings, so the check starts with no baseline"
          : `wrote ${total(found)} findings to ${shown}`,
      ],
      write: toBaseline(found, groups),
    };
  }

  if (mode === "write") {
    if (total(found) > total(allowed)) {
      return {
        failed: true,
        lines: [
          `--write only re-keys findings that moved, and ${total(found)} findings would grow ${shown} past its ${total(allowed)} entries. Fix the new findings first:`,
          ...fixLines,
        ],
      };
    }
    return {
      failed: false,
      lines: [`wrote ${total(found)} findings to ${shown}`],
      write: toBaseline(found, groups),
    };
  }

  if (mode === "prune") {
    return {
      failed: false,
      lines: [`removed ${stale.length} fixed entries from ${shown}`],
      write: toBaseline(kept, groups),
    };
  }

  if (added.length > 0) {
    return {
      failed: true,
      lines: [
        `${added.length} new findings.`,
        ...fixLines,
        baseline
          ? `Fix each as its line says. ${shown} lists the findings that existed when the check was turned on. It only shrinks, so never add to it. After renaming or moving a file that still has a finding, standard check ${check} --write re-keys it.`
          : "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.",
      ],
    };
  }
  if (stale.length > 0) {
    const staleLines = stale.map(
      ({ key, found: count }) =>
        `  ${groups.get(key)} ${key}: ${count === 0 ? "fixed" : `${count} left`}`,
    );
    const next = toBaseline(kept, groups);
    return {
      failed: true,
      lines: [
        next
          ? `${stale.length} baseline entries were fixed or moved, so this run rewrote ${shown} to match the code. Commit it with this change:`
          : `every finding in ${shown} is fixed, so this run deleted it. Commit the deletion with this change; the check now allows none:`,
        ...staleLines,
      ],
      write: next,
    };
  }
  return { failed: false, lines: [] };
}

/**
 * @param {object} input
 * @param {string} input.check
 * @param {string} input.path Absolute path of the baseline file.
 * @param {string} input.shown
 * @param {Finding[]} input.findings
 * @param {Mode} input.mode
 * @returns {{ failed: boolean, message: string }}
 */
export function ratchet({ check, path, shown, findings, mode }) {
  const baseline = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const { failed, lines, write } = verdict({ check, shown, findings, baseline, mode });
  if (write === null) rmSync(path, { force: true });
  else if (write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(write, null, 2)}\n`);
  }
  return { failed, message: lines.join("\n") };
}
