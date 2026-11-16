import commitSubject from "./checks/commit-subject.mjs";

/**
 * @typedef {import("./repo.mjs").Repo} Repo
 * @typedef {import("./subjects.mjs").Commit} Commit
 *
 * @typedef {object} Finding
 * @property {string} key Names what is wrong. A tree check's baseline lists keys.
 * @property {string} fix One line that says how to fix it.
 * @property {string} [group] Heading the key sits under in a baseline.
 * @property {true} [advisory] Reported, but does not fail the run.
 *
 * @typedef {{ on: true } | { on: false, because: string }} Applies
 *
 * @typedef {object} Named
 * @property {string} name
 * @property {string[]} retired Paths of the repo scripts this check replaces.
 *
 * @typedef {(Named & { subject: "commit", run(commit: Commit, repo: Repo): Finding[] })
 *   | (Named & { subject: "tree", applies(repo: Repo): Applies, run(repo: Repo): Finding[] | Promise<Finding[]> })} Check
 */

/** @type {Check[]} */
export const registry = [commitSubject];
