import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const KNIP = fileURLToPath(new URL("../bin/knip.js", import.meta.resolve("knip")));
const KNIP_LABEL = (() => {
  const unknown = "knip (version unknown)";
  try {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("knip")), "utf8"));
    return typeof version === "string" ? `knip ${version}` : unknown;
  } catch {
    return unknown;
  }
})();

const UNEXPORT = "Delete it, or drop the 'export' keyword if only this file uses it.";
const REMOVE = "Remove it with pnpm remove.";

/** @type {Record<string, [what: string, remedy: string]>} */
const KINDS = {
  files: ["Unused file", "Delete it, or add its entry point to knip.json (workspaces.<ws>.entry) if a tool runs it."],
  exports: ["Unused export", UNEXPORT],
  types: ["Unused exported type", UNEXPORT],
  nsExports: ["Unused export behind a namespace import", UNEXPORT],
  nsTypes: ["Unused exported type behind a namespace import", UNEXPORT],
  enumMembers: ["Unused enum member", "Delete it."],
  namespaceMembers: ["Unused namespace member", UNEXPORT],
  duplicates: ["Duplicate exports", "Keep one name and import it everywhere."],
  dependencies: ["Unused dependency", REMOVE],
  devDependencies: ["Unused devDependency", REMOVE],
  optionalPeerDependencies: ["Referenced optional peer dependency", "Add it to devDependencies with pnpm add -D."],
  unlisted: ["Unlisted dependency", "Add it to that workspace's package.json with pnpm add."],
  binaries: ["Unlisted binary", "Add the package that provides it with pnpm add -D, or list it in knip.json ignoreBinaries if the machine provides it."],
  unresolved: ["Unresolved import", "Fix the specifier, or add the file or package it names."],
  subpaths: ["Unused subpath", "Remove it from the exports or imports of package.json."],
  catalog: ["Unused catalog entry", "Remove it from the catalog."],
  catalogReferences: ["Unresolved catalog reference", "Add the package to the catalog it names, or pin a version."],
  cycles: ["Circular dependency", "Move what the files share into a module that imports none of them."],
};

/**
 * @typedef {{ name: string, namespace?: string, line?: number }} Entry
 *
 * @param {string} file
 * @param {string} kind
 * @param {Entry | Entry[]} entry A duplicates or cycles issue lists several names.
 * @returns {import("../registry.mjs").Finding}
 */
function finding(file, kind, entry) {
  const entries = [entry].flat();
  const name = entries.map((one) => (one.namespace ? `${one.namespace}.${one.name}` : one.name)).join(", ");
  const { line } = entries[0];
  const where = line ? `${file}:${line}` : file;
  const [what, remedy] = KINDS[kind] ?? [`Knip ${kind}`, "Remove what is unused, or declare what uses it in knip.json."];
  return name === file
    ? { key: `${file} ${kind}`, fix: `${what} ${file}. ${remedy}` }
    : { key: `${file} ${kind} ${name}`, fix: `${what} ${name} in ${where}. ${remedy}` };
}

/** Every row of knip 6's JSON reporter carries these issue lists, empty or not. */
const ALWAYS = [
  "binaries", "catalog", "catalogReferences", "dependencies", "devDependencies", "duplicates", "enumMembers",
  "exports", "files", "namespaceMembers", "optionalPeerDependencies", "types", "unlisted", "unresolved",
];

/**
 * @param {string} problem
 * @returns {Error}
 */
function unexpected(problem) {
  return new Error(
    `dead-code read a ${KNIP_LABEL} report it does not understand: ${problem}. Reinstall @mapringg/standard so it runs the knip it pins.`,
  );
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is Entry}
 */
function isEntry(value) {
  return isRecord(value) && typeof value.name === "string" && (value.line === undefined || typeof value.line === "number");
}

/**
 * @param {string} stdout
 * @returns {{ file: string, kinds: [string, (Entry | Entry[])[]][] }[]}
 */
function parseReport(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw unexpected(`its output is not JSON (${JSON.stringify(stdout.slice(0, 80))})`);
  }
  if (!isRecord(report) || !Array.isArray(report.issues)) throw unexpected("it has no issues list");
  const extra = Object.keys(report).filter((key) => key !== "issues");
  if (extra.length > 0) throw unexpected(`it has the unknown top-level key ${extra.join(", ")}`);
  return report.issues.map((row, index) => {
    if (!isRecord(row) || typeof row.file !== "string") throw unexpected(`row ${index} has no file name`);
    const missing = ALWAYS.filter((kind) => !(kind in row));
    if (missing.length > 0) throw unexpected(`row ${index} (${row.file}) lacks ${missing.join(", ")}`);
    /** @type {[string, (Entry | Entry[])[]][]} */
    const kinds = [];
    for (const [kind, entries] of Object.entries(row)) {
      // A repository with a CODEOWNERS file gets an owners list on each row, which is not an issue.
      if (kind === "file" || kind === "owners") continue;
      if (!(kind in KINDS)) throw unexpected(`row ${index} (${row.file}) has the unknown issue type ${kind}`);
      const valid =
        Array.isArray(entries) && entries.every((entry) => (Array.isArray(entry) ? entry.length > 0 && entry.every(isEntry) : isEntry(entry)));
      if (!valid) throw unexpected(`row ${index} (${row.file}) has ${kind} entries without a name`);
      kinds.push([kind, entries]);
    }
    return { file: row.file, kinds };
  });
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "dead-code",
  since: "0.8.0",
  doc: {
    enforces: "knip finds no unused file, export, type or dependency, and no unlisted dependency.",
    fix: "Delete the unused code or dependency, or add the missing one.",
    config: [],
  },
  subject: "tree",
  baseline: false,
  retired: ["scripts/check-dead-code.mjs", "scripts/check-dead-code.test.mjs", "scripts/baselines/dead-code.json"],
  applies: (repo) =>
    repo.files("package.json").length > 0 ? { on: true } : { on: false, because: "git tracks no package.json for knip to read" },
  async run(repo) {
    // --no-exit-code keeps knip's exit at 0 when it finds issues, so any failure here is knip itself failing.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [KNIP, "--no-progress", "--no-exit-code", "--reporter", "json"],
      { cwd: repo.root, maxBuffer: 256 * 1024 * 1024 },
    ).catch((error) => {
      throw new Error(`dead-code could not run ${KNIP_LABEL}. ${(error.stderr || error.message).trim()}`);
    });
    return parseReport(stdout).flatMap(({ file, kinds }) =>
      kinds.flatMap(([kind, entries]) => entries.map((entry) => finding(file, kind, entry))),
    );
  },
};
