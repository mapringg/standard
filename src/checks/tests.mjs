import { posix } from "node:path";

import { tracked } from "../repo.mjs";
import { checkJobScripts, isRealScript, runsScript } from "../wiring.mjs";
import { packageOf, TEST_FILE } from "./support/packages.mjs";

const RUNS_TEST = runsScript("test");

/**
 * @param {import("../repo.mjs").Repo} repo
 * @param {string} path
 * @returns {boolean}
 */
function hasScript(repo, path) {
  try {
    return isRealScript(JSON.parse(tracked(repo, path) ?? "{}").scripts?.test);
  } catch {
    return false;
  }
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "tests",
  since: "0.10.0",
  subject: "tree",
  baseline: false,
  retired: [],
  applies: (repo) => (repo.files("package.json").length > 0 ? { on: true } : { on: false, because: "git tracks no package.json" }),
  run(repo) {
    /** @type {import("../registry.mjs").Finding[]} */
    const findings = [];
    if (!hasScript(repo, "package.json")) {
      findings.push({ key: "package.json scripts.test", fix: `Add a test script that runs the tests, such as "turbo run test", to package.json, so CI and pre-push have one command to run.` });
    }
    const files = repo.files();
    const manifests = new Set(files.filter((path) => posix.basename(path) === "package.json"));
    const byPackage = Map.groupBy(files.filter((file) => TEST_FILE.test(file)), (path) => packageOf(manifests, path));
    for (const [folder, [example]] of byPackage) {
      if (folder === null || folder === "." || hasScript(repo, `${folder}/package.json`)) continue;
      findings.push({
        key: `${folder}/package.json scripts.test`,
        fix: `Add a test script that runs the tests to ${folder}/package.json, since turbo run test skips a package without one and so never runs ${example}.`,
      });
    }
    if (!repo.config.hooks["pre-push"].some(RUNS_TEST)) {
      findings.push({ key: "hooks.pre-push", fix: `Add "pnpm test" to hooks.pre-push in .standard/config.json, so a push that fails a test stops before CI.` });
    }
    const scripts = checkJobScripts(repo);
    if (scripts.length > 0 && !scripts.some(RUNS_TEST)) {
      findings.push({ key: "ci", fix: `Run "pnpm test" in a step of the Check job that has no continue-on-error, so a pull request that fails a test cannot merge.` });
    }
    return findings;
  },
};
