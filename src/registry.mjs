import banned from "./checks/banned.mjs";
import baselineGrowth from "./checks/baseline-growth.mjs";
import boundaries from "./checks/boundaries.mjs";
import clientData from "./checks/client-data.mjs";
import commitSubject from "./checks/commit-subject.mjs";
import deadCode from "./checks/dead-code.mjs";
import duplicates from "./checks/duplicates.mjs";
import noComments from "./checks/no-comments.mjs";
import prBody from "./checks/pr-body.mjs";
import prScreenshot from "./checks/pr-screenshot.mjs";
import prSize from "./checks/pr-size.mjs";
import prTests from "./checks/pr-tests.mjs";
import prTitle from "./checks/pr-title.mjs";
import react from "./checks/react.mjs";
import routeAwait from "./checks/route-await.mjs";
import usePromise from "./checks/use-promise.mjs";
import typecheck from "./checks/typecheck.mjs";
import tests from "./checks/tests.mjs";
import wiring from "./checks/wiring.mjs";

/**
 * @typedef {import("./repo.mjs").Repo} Repo
 * @typedef {import("./subjects.mjs").Commit} Commit
 * @typedef {import("./subjects.mjs").PullRequest} PullRequest
 *
 * @typedef {object} Finding
 * @property {string} key Names what is wrong. A tree check's baseline lists keys.
 * @property {string} fix One line that says how to fix it.
 * @property {string} [group] Heading the key sits under in a baseline.
 * @property {true} [advisory] Reported, but does not fail the run.
 *
 * @typedef {{ on: true } | { on: false, because: string }} Applies
 *
 * What a check enforces, the fix its findings name, and the `.standard/config.json` keys it reads. `standard explain` prints it.
 * @typedef {{ enforces: string, fix: string, config: readonly string[] }} Doc
 *
 * @typedef {object} Named
 * @property {string} name
 * @property {Doc} doc
 * @property {string[]} retired Paths of the repo scripts this check replaces.
 * @property {string} since The package version that added this check.
 *
 * @typedef {(Named & { subject: "commit", run(commit: Commit, repo: Repo): Finding[] })
 *   | (Named & { subject: "pr", applies?(repo: Repo): Applies, summary?(pr: PullRequest): string, run(pr: PullRequest, repo: Repo, checks: readonly Named[]): Finding[] | Promise<Finding[]> })
 *   | (Named & { subject: "tree", baseline?: false, moved?: Readonly<Record<string, string>>, applies(repo: Repo): Applies, run(repo: Repo, checks: readonly Named[]): Finding[] | Promise<Finding[]> })} Check
 * A tree check's `moved` maps a baseline group it no longer finds to the check that finds it now.
 */

/** @type {Check[]} */
export const registry = [commitSubject, prTitle, prBody, prScreenshot, prSize, baselineGrowth, wiring, deadCode, duplicates, typecheck, tests, prTests, boundaries, banned, react, clientData, routeAwait, usePromise, noComments];
