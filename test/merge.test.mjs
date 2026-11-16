import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { standard, tempDir, tempRepo } from "./helpers.mjs";

const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);
const TITLE = "Keep environment examples complete across every app";

const pr = { number: 194, title: TITLE, state: "OPEN", isDraft: false, baseRefName: "develop", headRefOid: HEAD };
const green = { name: "Check", head_sha: HEAD, status: "completed", conclusion: "success", app: { slug: "github-actions" } };

function fakeGh(t, view, runs) {
  const bin = tempDir(t, "bin");
  const calls = join(bin, "calls");
  const script = `#!/usr/bin/env node
const { appendFileSync } = process.getBuiltinModule("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
if (args[0] === "pr" && args[1] === "view") console.log(${JSON.stringify(JSON.stringify(view))});
if (args[0] === "api") console.log(${JSON.stringify(JSON.stringify([{ total_count: runs.length, check_runs: runs }]))});
`;
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return {
    env: { PATH: `${bin}:${process.env.PATH}` },
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
  };
}

function mergeWith(t, { view = {}, runs = [green], args = [] } = {}) {
  const gh = fakeGh(t, { ...pr, ...view }, runs);
  const result = standard(tempRepo(t), ["merge", "194", ...args], { env: gh.env });
  return { ...result, merged: gh.calls().filter(([command, sub]) => command === "pr" && sub === "merge") };
}

function assertRefused(result, reason) {
  assert.match(result.stderr, /^standard merge: refusing #194, because$/m);
  assert.match(result.stderr, reason);
  assert.equal(result.status, 1);
  assert.deepEqual(result.merged, []);
}

test("merge squashes a green pull request with the reviewed head, the numbered title and an empty body", (t) => {
  const { stdout, status, merged } = mergeWith(t);
  assert.deepEqual(merged, [
    ["pr", "merge", "194", "--squash", "--match-head-commit", HEAD, "--subject", `${TITLE} (#194)`, "--body", ""],
  ]);
  assert.equal(
    stdout.trim(),
    `standard merge: gh pr merge 194 --squash --match-head-commit ${HEAD} --subject '${TITLE} (#194)' --body ''`,
  );
  assert.equal(status, 0);
});

test("merge reads the pull request and its head's check runs live through gh", (t) => {
  const gh = fakeGh(t, pr, [green]);
  standard(tempRepo(t), ["merge", "194"], { env: gh.env });
  assert.deepEqual(gh.calls().slice(0, 2), [
    ["pr", "view", "194", "--json", "number,title,state,isDraft,baseRefName,headRefOid"],
    ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${HEAD}/check-runs?per_page=100`],
  ]);
});

test("merge passes --admin through and still needs a green Check", (t) => {
  assert.equal(mergeWith(t, { args: ["--admin"] }).merged[0].at(-1), "--admin");
  assertRefused(mergeWith(t, { args: ["--admin"], runs: [] }), /no Check run from github-actions/);
});

test("merge replaces a stale number at the end of the title", (t) => {
  const { merged } = mergeWith(t, { view: { title: `${TITLE} (#193)` } });
  assert.equal(merged[0][7], `${TITLE} (#194)`);
});

test("merge refuses a draft", (t) => {
  assertRefused(mergeWith(t, { view: { isDraft: true } }), /^ {2}it is a draft\.$/m);
});

test("merge refuses a pull request that is not open", (t) => {
  assertRefused(mergeWith(t, { view: { state: "MERGED" } }), /^ {2}it is merged, not open\.$/m);
});

test("merge refuses a base of main", (t) => {
  assertRefused(mergeWith(t, { view: { baseRefName: "main" } }), /^ {2}its base is main, not develop\.$/m);
});

test("merge refuses a red Check, naming its conclusion", (t) => {
  const runs = [{ ...green, conclusion: "failure" }];
  assertRefused(mergeWith(t, { runs }), /^ {2}Check from github-actions on aaaaaaa concluded failure\.$/m);
});

test("merge refuses a Check that is still running", (t) => {
  const runs = [{ ...green, status: "in_progress", conclusion: null }];
  assertRefused(mergeWith(t, { runs }), /^ {2}Check from github-actions on aaaaaaa is in_progress\.$/m);
});

test("merge refuses a missing Check, naming the runs it found", (t) => {
  assertRefused(mergeWith(t, { runs: [] }), new RegExp(`no Check run from github-actions on head ${HEAD}\\. Found no check runs\\.`));
  const others = [{ ...green, name: "lint" }, { ...green, app: { slug: "some-app" } }];
  assertRefused(
    mergeWith(t, { runs: others }),
    /Found lint from github-actions on aaaaaaa concluded success; Check from some-app on aaaaaaa concluded success\./,
  );
});

test("merge refuses a green Check on an older commit", (t) => {
  assertRefused(
    mergeWith(t, { runs: [{ ...green, head_sha: OLDER }] }),
    /no Check run from github-actions on head a{40}\. Found Check from github-actions on bbbbbbb concluded success\./,
  );
});

test("merge refuses a title that breaks the subject rules", (t) => {
  assertRefused(mergeWith(t, { view: { title: "fixed stuff" } }), /its title breaks a subject rule\. Subject does not start with a capital letter\./);
  const long = "Keep every environment example complete across each app in this whole repo";
  assertRefused(mergeWith(t, { view: { title: long } }), /Subject is 81 characters with the " \(#194\)" the squash adds/);
});

test("merge needs a pull request number and takes only --admin", (t) => {
  for (const args of [["merge"], ["merge", "abc"], ["merge", "194", "--force"]]) {
    const { stderr, status } = standard(tempRepo(t), args);
    assert.match(stderr, /merge needs a pull request number and takes only --admin\./);
    assert.equal(status, 1);
  }
});
