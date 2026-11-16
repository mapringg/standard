import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { standard, tempDir, tempRepo } from "./helpers.mjs";

const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);
const TITLE = "Keep environment examples complete across every app";

const pr = { number: 194, title: TITLE, state: "OPEN", isDraft: false, baseRefName: "develop", headRefOid: HEAD };
const CI = 7;

function run(id, { event = "pull_request", started = "2026-11-10T10:00:00Z", attempt = 1, status = "completed", conclusion = "success", check = {}, sha = HEAD, workflow = CI } = {}) {
  const workflowRun = { id, workflow_id: workflow, event, head_sha: sha, check_suite_id: id * 10, run_attempt: attempt, run_started_at: started, status, conclusion };
  const checkRun = check && {
    name: "Check",
    head_sha: sha,
    status,
    conclusion,
    started_at: started,
    app: { slug: "github-actions" },
    check_suite: { id: id * 10 },
    ...check,
  };
  return { workflowRun, checkRun };
}

const green = run(1);

function pages(items, key, size = 2) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push({ total_count: items.length, [key]: items.slice(i, i + size) });
  return chunks.length > 0 ? chunks : [{ total_count: 0, [key]: [] }];
}

function fakeGh(t, view, runs, events) {
  const bin = tempDir(t, "bin");
  const calls = join(bin, "calls");
  const answers = {
    "check-runs": pages(runs.flatMap((r) => (r.checkRun ? [r.checkRun] : [])), "check_runs"),
    "actions/runs": pages(runs.map((r) => r.workflowRun), "workflow_runs"),
    "/events": [events.slice(0, 1), events.slice(1)],
  };
  const script = `#!/usr/bin/env node
const { appendFileSync } = process.getBuiltinModule("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const answers = ${JSON.stringify(answers)};
if (args[0] === "pr" && args[1] === "view") console.log(${JSON.stringify(JSON.stringify(view))});
if (args[0] === "api") console.log(JSON.stringify(Object.entries(answers).find(([path]) => args.at(-1).includes(path))[1]));
`;
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return {
    env: { PATH: `${bin}:${process.env.PATH}` },
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
  };
}

function mergeWith(t, { view = {}, runs = [green], events = [], args = [] } = {}) {
  const gh = fakeGh(t, { ...pr, ...view }, runs, events);
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

test("merge reads the pull request, its head's check runs and workflow runs, and its events live through gh", (t) => {
  const gh = fakeGh(t, pr, [green], []);
  standard(tempRepo(t), ["merge", "194"], { env: gh.env });
  assert.deepEqual(gh.calls().slice(0, 4), [
    ["pr", "view", "194", "--json", "number,title,state,isDraft,baseRefName,headRefOid"],
    ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${HEAD}/check-runs?filter=latest&per_page=100`],
    ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${HEAD}&per_page=100`],
    ["api", "--paginate", "--slurp", "repos/{owner}/{repo}/issues/194/events?per_page=100"],
  ]);
});

test("merge passes --admin through and still needs a green Check", (t) => {
  assert.equal(mergeWith(t, { args: ["--admin"] }).merged[0].at(-1), "--admin");
  assertRefused(mergeWith(t, { args: ["--admin"], runs: [] }), /no Check run from github-actions in a pull_request run/);
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

test("merge refuses when the newest Check concluded anything but success, naming the conclusion", (t) => {
  for (const conclusion of ["failure", "cancelled", "skipped", "timed_out"]) {
    const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", conclusion })];
    assertRefused(
      mergeWith(t, { runs }),
      new RegExp(`^ {2}Check in pull_request run 2 attempt 1, the newest on aaaaaaa, concluded ${conclusion}\\.$`, "m"),
    );
  }
});

test("merge waits for a newer Check that has not finished, even after an older success", (t) => {
  for (const status of ["queued", "in_progress"]) {
    const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", status, conclusion: null })];
    assertRefused(
      mergeWith(t, { runs }),
      new RegExp(`^ {2}wait: Check in pull_request run 2 attempt 1, the newest on aaaaaaa, is ${status}\\.$`, "m"),
    );
  }
});

test("merge waits for a newer workflow run that has no Check run yet", (t) => {
  const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", status: "pending", conclusion: null, check: null })];
  assertRefused(
    mergeWith(t, { runs }),
    /^ {2}wait: pull_request run 2 attempt 1, the newest on aaaaaaa, is pending and has no Check run yet\.$/m,
  );
});

test("merge refuses when the newest workflow run ended without a Check run", (t) => {
  const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", conclusion: "startup_failure", check: null })];
  assertRefused(
    mergeWith(t, { runs }),
    /^ {2}pull_request run 2 attempt 1, the newest on aaaaaaa, concluded startup_failure without a Check run\.$/m,
  );
});

test("merge ignores older cancelled and skipped Check runs once the newest is green", (t) => {
  const runs = [
    run(1, { started: "2026-11-10T09:00:00Z", conclusion: "skipped" }),
    run(2, { started: "2026-11-10T10:00:00Z", conclusion: "cancelled" }),
    run(3, { started: "2026-11-10T11:00:00Z" }),
  ];
  assert.equal(mergeWith(t, { runs }).merged.length, 1);
});

test("merge orders runs by when their latest attempt started, so a rerun of an older run is the newest", (t) => {
  const rerun = run(1, { attempt: 2, started: "2026-11-10T12:00:00Z", status: "in_progress", conclusion: null });
  const runs = [rerun, run(2, { started: "2026-11-10T11:00:00Z" })];
  assertRefused(mergeWith(t, { runs }), /wait: Check in pull_request run 1 attempt 2, the newest on aaaaaaa, is in_progress\./);
  const failedOlder = [run(1, { attempt: 2, started: "2026-11-10T10:00:00Z", conclusion: "failure" }), run(2, { started: "2026-11-10T11:00:00Z" })];
  assert.equal(mergeWith(t, { runs: failedOlder }).merged.length, 1);
});

test("merge breaks a tie in start time by the later workflow run", (t) => {
  const runs = [run(3, { conclusion: "cancelled" }), run(2)];
  assertRefused(mergeWith(t, { runs }), /Check in pull_request run 3 attempt 1, the newest on aaaaaaa, concluded cancelled\./);
});

test("merge ignores runs of workflows that hold no Check", (t) => {
  const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", workflow: 9, conclusion: "failure", check: { name: "lint" } })];
  assert.equal(mergeWith(t, { runs }).merged.length, 1);
});

test("merge counts only Check runs from pull_request workflow runs, naming the event of the rest", (t) => {
  const runs = [run(1, { event: "push" }), run(2, { event: "pull_request_target", started: "2026-11-10T11:00:00Z" })];
  assertRefused(
    mergeWith(t, { runs }),
    /no Check run from github-actions in a pull_request run on head a{40}\. Found Check from github-actions on aaaaaaa in a push run concluded success; Check from github-actions on aaaaaaa in a pull_request_target run concluded success\./,
  );
  const runsWithPush = [green, run(2, { event: "push", started: "2026-11-10T11:00:00Z", conclusion: "failure" })];
  assert.equal(mergeWith(t, { runs: runsWithPush }).merged.length, 1);
});

test("merge refuses a Check that started before the pull request last left draft", (t) => {
  const events = [
    { event: "ready_for_review", created_at: "2026-11-10T09:00:00Z" },
    { event: "convert_to_draft", created_at: "2026-11-10T09:30:00Z" },
    { event: "ready_for_review", created_at: "2026-11-10T10:30:00Z" },
  ];
  assertRefused(
    mergeWith(t, { events }),
    /^ {2}Check in pull_request run 1 attempt 1, the newest on aaaaaaa, started at 2026-11-10T10:00:00Z, before the pull request left draft at 2026-11-10T10:30:00Z\. Rerun Check, or add ready_for_review to on.pull_request.types\.$/m,
  );
  const after = [green, run(2, { started: "2026-11-10T10:31:00Z" })];
  assert.equal(mergeWith(t, { runs: after, events }).merged.length, 1);
});

test("merge keeps the start of a Check that a partial rerun copied from a draft-time attempt", (t) => {
  const events = [{ event: "ready_for_review", created_at: "2026-11-10T10:30:00Z" }];
  const copied = run(1, { attempt: 2, started: "2026-11-10T11:00:00Z", check: { started_at: "2026-11-10T10:00:00Z" } });
  assertRefused(mergeWith(t, { runs: [copied], events }), /started at 2026-11-10T10:00:00Z, before the pull request left draft/);
});

test("merge reads every page of check runs and workflow runs", (t) => {
  const runs = [1, 2, 3, 4, 5].map((id) => run(id, { started: `2026-11-10T1${id}:00:00Z`, conclusion: id === 5 ? "success" : "cancelled" }));
  assert.equal(mergeWith(t, { runs }).merged.length, 1);
});

test("merge refuses a missing Check, naming the runs it found", (t) => {
  assertRefused(mergeWith(t, { runs: [] }), new RegExp(`no Check run from github-actions in a pull_request run on head ${HEAD}\\. Found no check runs\\.`));
  const others = [run(1, { check: { name: "lint" } }), run(2, { check: { app: { slug: "some-app" } } })];
  assertRefused(
    mergeWith(t, { runs: others }),
    /Found lint from github-actions on aaaaaaa in a pull_request run concluded success; Check from some-app on aaaaaaa in a pull_request run concluded success\./,
  );
});

test("merge refuses a green Check on an older commit", (t) => {
  assertRefused(
    mergeWith(t, { runs: [run(1, { sha: OLDER })] }),
    /no Check run from github-actions in a pull_request run on head a{40}\. Found Check from github-actions on bbbbbbb in a pull_request run concluded success\./,
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
