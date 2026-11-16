import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const KNIP = fileURLToPath(new URL("../bin/knip.js", import.meta.resolve("knip")));

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

/** @type {import("../registry.mjs").Check} */
export default {
  name: "dead-code",
  since: "0.8.0",
  subject: "tree",
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
      throw new Error(`dead-code could not run knip. ${(error.stderr || error.message).trim()}`);
    });
    /** @type {{ issues: ({ file: string, owners?: unknown } & Record<string, (Entry | Entry[])[]>)[] }} */
    const { issues } = JSON.parse(stdout);
    // A repository with a CODEOWNERS file gets an owners list on each row, which is not an issue.
    return issues.flatMap(({ file, owners: _owners, ...kinds }) =>
      Object.entries(kinds).flatMap(([kind, entries]) => entries.map((entry) => finding(file, kind, entry))),
    );
  },
};
