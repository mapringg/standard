import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { GOOD_BODY, git, pullRequestRepo, standard, tempDir, tempRepo, write } from "./helpers.mjs";

function sharedRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "standard-merge-"));
  after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-q", "-b", "develop");
  write(cwd, { ".standard/config.json": {}, "README.md": "start" });
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--no-verify", "-m", "Start the repository");
  const base = git(cwd, "rev-parse", "HEAD");
  git(cwd, "switch", "-q", "-c", "feature");
  write(cwd, { "README.md": "changed" });
  git(cwd, "commit", "-q", "-a", "--no-verify", "-m", "Change the sample files");
  return { cwd, base, head: git(cwd, "rev-parse", "HEAD") };
}

const shared = sharedRepo();
const HEAD = shared.head;
const SHORT = HEAD.slice(0, 7);
const OLDER = "b".repeat(40);
const TITLE = "Keep environment examples complete across every app";

const pr = {
  number: 194,
  title: TITLE,
  state: "OPEN",
  isDraft: false,
  baseRefName: "develop",
  headRefOid: HEAD,
  baseRefOid: shared.base,
  headRefName: "feature",
  body: GOOD_BODY,
  author: { login: "someone" },
  additions: 1,
  deletions: 0,
};
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

function lines(items) {
  return items.map((item) => JSON.stringify(item)).join("\n");
}

function fakeGh(t, views, { runs, before = runs, events, mergeFails = false }) {
  const bin = tempDir(t, "bin");
  const calls = join(bin, "calls");
  const answers = {
    "check-runs": lines(runs.flatMap((r) => (r.checkRun ? [r.checkRun] : []))),
    "actions/runs": [lines(before.flatMap((r) => (r.workflowRun ? [r.workflowRun] : []))), lines(runs.flatMap((r) => (r.workflowRun ? [r.workflowRun] : [])))],
    "/events": lines(events.filter((e) => e.event === "ready_for_review").map(({ created_at }) => ({ created_at }))),
  };
  const script = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = process.getBuiltinModule("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const answers = ${JSON.stringify(answers)};
const views = ${JSON.stringify(views)};
if (args[0] === "pr" && args[1] === "view") {
  const reads = readFileSync(${JSON.stringify(calls)}, "utf8").split("\\n").filter((line) => line.startsWith('["pr","view"')).length;
  console.log(JSON.stringify(views[Math.min(reads, views.length) - 1]));
}
if (args[0] === "pr" && args[1] === "merge" && ${mergeFails}) {
  console.error("Head branch was modified. Review and try the merge again.");
  process.exit(1);
}
if (args[0] === "api") {
  const path = args.at(-1);
  const answer = Object.entries(answers).find(([key]) => path.includes(key))[1];
  const reads = readFileSync(${JSON.stringify(calls)}, "utf8").split("\\n").filter((line) => line.includes(path)).length;
  console.log(Array.isArray(answer) ? answer[Math.min(reads, answer.length) - 1] : answer);
}
`;
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return {
    env: { PATH: `${bin}:${process.env.PATH}` },
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
  };
}

function mergeWith(t, { view = {}, reread = view, cwd = shared.cwd, runs = [green], before, events = [], mergeFails, args = [] } = {}) {
  const gh = fakeGh(t, [{ ...pr, ...view }, { ...pr, ...view, ...reread }], { runs, before, events, mergeFails });
  const result = standard(cwd, ["merge", "194", ...args], { env: gh.env });
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

test("merge reads the pull request, its events, then the workflow runs on both sides of the check runs, live through gh", (t) => {
  const gh = fakeGh(t, [pr], { runs: [green], events: [] });
  standard(shared.cwd, ["merge", "194"], { env: gh.env });
  const [view, ...reads] = gh.calls().slice(0, 5);
  assert.deepEqual(view, ["pr", "view", "194", "--json", "number,title,state,isDraft,baseRefName,headRefOid"]);
  assert.deepEqual(
    reads.map(([api, paginate, jq, filter, path]) => [api, paginate, jq, typeof filter, path]),
    [
      "repos/{owner}/{repo}/issues/194/events?per_page=100",
      `repos/{owner}/{repo}/actions/runs?head_sha=${HEAD}&per_page=100`,
      `repos/{owner}/{repo}/commits/${HEAD}/check-runs?filter=latest&per_page=100`,
      `repos/{owner}/{repo}/actions/runs?head_sha=${HEAD}&per_page=100`,
    ].map((path) => ["api", "--paginate", "--jq", "string", path]),
  );
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
      new RegExp(`^ {2}Check in pull_request run 2 attempt 1, the newest on ${SHORT}, concluded ${conclusion}\\.$`, "m"),
    );
  }
});

test("merge waits for a newer Check that has not finished, even after an older success", (t) => {
  for (const status of ["queued", "in_progress"]) {
    const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", status, conclusion: null })];
    assertRefused(
      mergeWith(t, { runs }),
      new RegExp(`^ {2}wait: pull_request run 2 attempt 1 of workflow 7 on ${SHORT} is ${status}\\.$`, "m"),
    );
  }
});

test("merge waits for a newer workflow run that has no Check run yet", (t) => {
  const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", status: "pending", conclusion: null, check: null })];
  assertRefused(
    mergeWith(t, { runs }),
    new RegExp(String.raw`^ {2}wait: pull_request run 2 attempt 1 of workflow 7 on ${SHORT} is pending\.$`, "m"),
  );
});

test("merge refuses when the newest workflow run ended without a Check run", (t) => {
  const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", conclusion: "startup_failure", check: null })];
  assertRefused(
    mergeWith(t, { runs }),
    new RegExp(String.raw`^ {2}pull_request run 2 attempt 1, the newest on ${SHORT}, concluded startup_failure without a Check run\.$`, "m"),
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
  const rerun = run(1, { attempt: 2, started: "2026-11-10T12:00:00Z", conclusion: "failure" });
  const runs = [rerun, run(2, { started: "2026-11-10T11:00:00Z" })];
  assertRefused(mergeWith(t, { runs }), new RegExp(String.raw`Check in pull_request run 1 attempt 2, the newest on ${SHORT}, concluded failure\.`));
  const failedOlder = [run(1, { attempt: 2, started: "2026-11-10T10:00:00Z", conclusion: "failure" }), run(2, { started: "2026-11-10T11:00:00Z" })];
  assert.equal(mergeWith(t, { runs: failedOlder }).merged.length, 1);
});

test("merge breaks a tie in start time by the later workflow run", (t) => {
  const runs = [run(3, { conclusion: "cancelled" }), run(2)];
  assertRefused(mergeWith(t, { runs }), new RegExp(String.raw`Check in pull_request run 3 attempt 1, the newest on ${SHORT}, concluded cancelled\.`));
});

test("merge ignores runs of workflows that hold no Check", (t) => {
  const runs = [green, run(2, { started: "2026-11-10T11:00:00Z", workflow: 9, conclusion: "failure", check: { name: "lint" } })];
  assert.equal(mergeWith(t, { runs }).merged.length, 1);
});

test("merge counts only Check runs from pull_request workflow runs, naming the event of the rest", (t) => {
  const runs = [run(1, { event: "push" }), run(2, { event: "pull_request_target", started: "2026-11-10T11:00:00Z" })];
  assertRefused(
    mergeWith(t, { runs }),
    new RegExp(String.raw`no Check run from github-actions in a pull_request run on head ${HEAD}\. Found Check from github-actions on ${SHORT} in a push run concluded success; Check from github-actions on ${SHORT} in a pull_request_target run concluded success\.`),
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
    new RegExp(String.raw`^ {2}Check in pull_request run 1 attempt 1, the newest on ${SHORT}, started at 2026-11-10T10:00:00Z, before the pull request left draft at 2026-11-10T10:30:00Z\. Rerun Check, or add ready_for_review to on.pull_request.types\.$`, "m"),
  );
  const after = [green, run(2, { started: "2026-11-10T10:31:00Z" })];
  assert.equal(mergeWith(t, { runs: after, events }).merged.length, 1);
});

test("merge keeps the start of a Check that a partial rerun copied from a draft-time attempt", (t) => {
  const events = [{ event: "ready_for_review", created_at: "2026-11-10T10:30:00Z" }];
  const copied = run(1, { attempt: 2, started: "2026-11-10T11:00:00Z", check: { started_at: "2026-11-10T10:00:00Z" } });
  assertRefused(mergeWith(t, { runs: [copied], events }), /started at 2026-11-10T10:00:00Z, before the pull request left draft/);
});

test("merge waits for a re-run attempt that carries a green Check from the earlier attempt", (t) => {
  for (const status of ["queued", "in_progress"]) {
    const carried = run(1, { attempt: 2, started: "2026-11-10T11:00:00Z", status, conclusion: null, check: { status: "completed", conclusion: "success" } });
    assertRefused(mergeWith(t, { runs: [carried] }), new RegExp(`^ {2}wait: pull_request run 1 attempt 2 of workflow 7 on ${SHORT} is ${status}\\.$`, "m"));
  }
});

test("merge refuses with retry when the newest run changes between the reads around the check runs", (t) => {
  const rerun = run(1, { attempt: 2, started: "2026-11-10T11:00:00Z", conclusion: "failure" });
  assertRefused(
    mergeWith(t, { before: [green], runs: [{ ...rerun, checkRun: green.checkRun }] }),
    new RegExp(String.raw`^ {2}retry: the newest pull_request run on ${SHORT} changed from run 1 attempt 1 completed to run 1 attempt 2 completed while standard merge read the runs\. Run standard merge again\.$`, "m"),
  );
  const newer = run(2, { started: "2026-11-10T11:00:00Z" });
  assertRefused(mergeWith(t, { before: [green], runs: [green, newer] }), /retry: .* from run 1 attempt 1 completed to run 2 attempt 1 completed/);
  assertRefused(mergeWith(t, { before: [], runs: [green] }), /retry: .* from no run to run 1 attempt 1 completed/);
});

test("merge reads workflow runs larger than the default output buffer", (t) => {
  const padding = "x".repeat(12_000);
  const runs = Array.from({ length: 106 }, (_, i) => {
    const r = run(i + 1, { started: i === 105 ? "2026-11-10T12:00:00Z" : "2026-11-10T10:00:00Z", conclusion: i === 105 ? "success" : "cancelled" });
    return { ...r, workflowRun: { ...r.workflowRun, padding } };
  });
  assert.equal(mergeWith(t, { runs }).merged.length, 1);
});

test("merge refuses a missing Check, naming the runs it found", (t) => {
  assertRefused(mergeWith(t, { runs: [] }), new RegExp(`no Check run from github-actions in a pull_request run on head ${HEAD}\\. Found no check runs\\.`));
  const others = [run(1, { check: { name: "lint" } }), run(2, { check: { app: { slug: "some-app" } } })];
  assertRefused(
    mergeWith(t, { runs: others }),
    new RegExp(String.raw`Found lint from github-actions on ${SHORT} in a pull_request run concluded success; Check from some-app on ${SHORT} in a pull_request run concluded success\.`),
  );
});

test("merge refuses a green Check on an older commit", (t) => {
  assertRefused(
    mergeWith(t, { runs: [run(1, { sha: OLDER })] }),
    new RegExp(String.raw`no Check run from github-actions in a pull_request run on head ${HEAD}\. Found Check from github-actions on bbbbbbb in a pull_request run concluded success\.`),
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

const OLD = "2026-11-16T10:00:00Z";
const MID = "2026-11-16T11:00:00Z";
const NEW = "2026-11-16T12:00:00Z";
const ready = (time) => ({ event: "ready_for_review", created_at: time });
const at = (id, options = {}) => run(id, { started: OLD, ...options });
const carried = (status) => at(1, { started: NEW, attempt: 2, status, conclusion: null, check: { status: "completed", conclusion: "success", started_at: OLD } });
const fork = at(1);
fork.workflowRun.head_repository = { fork: true };
const manyCancelled = Array.from({ length: 105 }, (_, i) => at(i + 1, { conclusion: "cancelled" }));
const unrelated = Array.from({ length: 105 }, (_, i) => ({ workflowRun: null, checkRun: { ...at(1).checkRun, name: `job-${i}` } }));

const verifierCases = [
  ["normal-green", true, [at(1)]],
  ["never-drafted", true, [at(1)]],
  ["cancelled-then-green", true, [at(1, { conclusion: "cancelled" }), at(2, { started: NEW })]],
  ["skipped-then-green", true, [at(1, { conclusion: "skipped" }), at(2, { started: NEW })]],
  ["newer-queued-no-check", false, [at(1), at(2, { started: NEW, status: "queued", conclusion: null, check: null })]],
  ["newer-running-no-check", false, [at(1), at(2, { started: NEW, status: "in_progress", conclusion: null, check: null })]],
  ["old-id-rerun-newest-failure", false, [at(2, { started: MID }), at(1, { started: NEW, attempt: 2, conclusion: "failure" })]],
  ["old-id-rerun-newest-green", true, [at(2, { started: MID, conclusion: "failure" }), at(1, { started: NEW, attempt: 2 })]],
  ["same-time-id-tie", false, [at(1), at(2, { conclusion: "failure" })]],
  ["two-workflows-pr-green-push-failed", true, [at(1), at(2, { workflow: 8, event: "push", started: NEW, conclusion: "failure" })]],
  ["two-workflows-pr-failed-push-green", false, [at(1, { conclusion: "failure" }), at(2, { workflow: 8, event: "push", started: NEW })]],
  ["fork-pull-request", true, [fork]],
  ["pull-request-target", false, [at(1, { event: "pull_request_target" })]],
  ["non-actions-app", false, [at(1, { check: { app: { slug: "other-app" } } })]],
  ["two-ready-events-stale", false, [at(1, { started: MID })], { events: [ready(OLD), { event: "convert_to_draft", created_at: MID }, ready(NEW)] }],
  ["two-ready-events-fresh", true, [at(1, { started: NEW })], { events: [ready(OLD), { event: "convert_to_draft", created_at: MID }, ready(MID)] }],
  ["partial-rerun-copies-draft-time", false, [at(1, { started: NEW, attempt: 2, check: { started_at: OLD } })], { events: [ready(MID)] }],
  ["rerun-in-progress-copied-green-check", false, [carried("in_progress")]],
  ["rerun-queued-copied-green-check", false, [carried("queued")]],
  ["rerun-starts-between-check-and-workflow-reads", false, [{ ...at(1, { started: NEW, attempt: 2, status: "in_progress", conclusion: null }), checkRun: at(1).checkRun }]],
  ["rerun-starts-between-the-workflow-reads", false, [{ ...at(1, { started: NEW, attempt: 2, status: "queued", conclusion: null }), checkRun: at(1).checkRun }], { before: [at(1)] }],
  ["head-moved-after-reads", false, [at(1)], { mergeFails: true }],
  ["over-100-checks-newest-green-on-page-2", true, [...manyCancelled, at(106, { started: NEW })]],
  ["over-100-checks-newest-failure-on-page-2", false, [...manyCancelled, at(106, { started: NEW, conclusion: "failure" })]],
  ["over-100-events-latest-ready-on-page-2", false, [at(1, { started: MID })], { events: [...Array.from({ length: 101 }, () => ({ event: "labeled", created_at: OLD })), ready(NEW)] }],
  ["over-100-checks-one-workflow", true, [...unrelated, at(1)]],
  ...["cancelled", "skipped", "neutral", "timed_out", "action_required", "failure", "stale"].map((conclusion) => [`latest-${conclusion}`, false, [at(1, { conclusion })]]),
];

test("merge waits for every pull_request workflow run on the head, even one whose Check run does not exist yet", (t) => {
  const otherWorkflow = run(2, { workflow: 8, started: "2026-11-10T11:00:00Z", status: "queued", conclusion: null, check: null });
  assertRefused(mergeWith(t, { before: [green], runs: [green, otherWorkflow] }), new RegExp(String.raw`^ {2}wait: pull_request run 2 attempt 1 of workflow 8 on ${SHORT} is queued\.$`, "m"));
  assertRefused(mergeWith(t, { before: [green, otherWorkflow], runs: [green] }), new RegExp(String.raw`wait: pull_request run 2 attempt 1 of workflow 8 on ${SHORT} is queued\.`));
  const pushRun = run(3, { event: "push", started: "2026-11-10T11:00:00Z", status: "in_progress", conclusion: null, check: null });
  assert.equal(mergeWith(t, { runs: [green, pushRun] }).merged.length, 1);
});

const newer = (options = {}) => at(2, { started: NEW, ...options });
const manyCancelledLater = Array.from({ length: 6000 }, (_, i) => at(i + 100, { started: "2026-11-16T09:00:00Z", conclusion: "cancelled", check: null }));
const freshCases = [
  ["new-id-completed-between-reads", false, [at(1), newer({ check: null })], { before: [at(1)] }],
  ["new-id-queued-between-reads", false, [at(1), newer({ status: "queued", conclusion: null, check: null })], { before: [at(1)] }],
  ["same-tuple-changed-start-time", true, [at(1, { started: NEW, check: { started_at: OLD } })], { before: [at(1)] }],
  ["completed-newest-check-missing", false, [at(1), newer({ check: null })]],
  ["only-completed-check-missing", false, [at(1, { check: null })]],
  ["check-success-later-job-failure", true, [{ ...at(1), workflowRun: { ...at(1).workflowRun, conclusion: "failure" } }, { workflowRun: null, checkRun: { ...at(1).checkRun, name: "Deploy", conclusion: "failure" } }]],
  ["jq-two-pages-multiple-documents", true, [{ workflowRun: null, checkRun: { ...at(1).checkRun, name: "Lint" } }, at(1)], { events: [{ event: "labeled", created_at: "2026-11-16T13:00:00Z" }, ready("2026-11-16T09:00:00Z"), ready("2026-11-16T09:30:00Z")] }],
  ["projection-large-raw-responses", true, [{ ...at(1), workflowRun: { ...at(1).workflowRun, padding: "x".repeat(2 * 1024 * 1024) } }]],
  ["projected-output-over-one-mib", true, [...manyCancelledLater, at(1)]],
  ["brand-new-check-workflow-between-reads", false, [at(1), newer({ workflow: 8, status: "queued", conclusion: null, check: null })], { before: [at(1)] }],
];

test("merge decides every case of the independent verifier", (t) => {
  const mismatches = [...verifierCases, ...freshCases].flatMap(([name, merges, runs, options = {}]) => {
    const { status, merged } = mergeWith(t, { runs, ...options });
    return (merges ? status === 0 && merged.length === 1 : status !== 0) ? [] : [name];
  });
  assert.deepEqual(mismatches, []);
});

const WARNED_BODY = [
  "## Summary",
  "",
  "Keep every environment example complete, so a new app starts with the keys it needs.",
  "",
  "## Evidence",
  "",
  "Ran the example check on every app.",
  "",
  "## Merge Danger",
  "",
  "**Door:** two-way",
  "",
  "**Blast Radius:** env examples only",
].join("\n");

test("merge refuses a description with warnings, listing each finding with its fix, even with --admin", (t) => {
  for (const args of [[], ["--admin"]]) {
    const result = mergeWith(t, { view: { body: WARNED_BODY }, args });
    assertRefused(result, /^ {2}its description breaks the pull request rules, and standard merge allows no finding, not even a warning:$/m);
    assert.match(result.stderr, /^ {4}pr-body: warning: Evidence: Evidence has no "\*\*Before:\*\*" \/ "\*\*After:\*\*" pair and no table with Before and After columns\.$/m);
    assert.match(result.stderr, /^ {4}pr-body: warning: Blast Radius: Blast Radius "env examples only" is more than one word\. Name the area in one word, then describe the risk below it\.$/m);
    assert.match(result.stderr, /^ {2}Edit the pull request description to fix them, no push needed, then run standard merge again\.$/m);
  }
});

test("merge reads the description again after the Check decision, right before it merges", (t) => {
  const gh = fakeGh(t, [pr], { runs: [green], events: [] });
  standard(shared.cwd, ["merge", "194"], { env: gh.env });
  const calls = gh.calls();
  assert.deepEqual(calls.at(-2).slice(0, 2), ["pr", "view"]);
  assert.match(calls.at(-2)[4], /\bbody\b/);
  assert.deepEqual(calls.at(-1).slice(0, 2), ["pr", "merge"]);
});

test("merge judges the description it reads last, not the one it read first", (t) => {
  assertRefused(mergeWith(t, { reread: { body: WARNED_BODY } }), /pr-body: warning: Blast Radius/);
  assert.equal(mergeWith(t, { view: { body: WARNED_BODY }, reread: { body: GOOD_BODY } }).merged.length, 1);
});

test("merge refuses with retry when the head or the title changes between its reads", (t) => {
  const moved = mergeWith(t, { reread: { headRefOid: shared.base } });
  assertRefused(moved, new RegExp(String.raw`^ {2}retry: the head moved from ${SHORT} to ${shared.base.slice(0, 7)} while standard merge read the pull request\. Run standard merge again\.$`, "m"));
  const retitled = mergeWith(t, { reread: { title: "Keep only some environment examples" } });
  assertRefused(retitled, new RegExp(String.raw`^ {2}retry: the title changed from "${TITLE}" to "Keep only some environment examples" while standard merge read the pull request\. Run standard merge again\.$`, "m"));
});

test("merge does not enforce a pending pr-body", (t) => {
  const repo = pullRequestRepo(t, { base: { ".standard/config.json": { pending: ["pr-body"] } } });
  const runs = [run(1, { sha: repo.head })];
  const view = { body: WARNED_BODY, headRefOid: repo.head, baseRefOid: repo.base };
  assert.equal(mergeWith(t, { cwd: repo.cwd, runs, view }).merged.length, 1);
});

test("merge needs a screenshot under pr.screenshots as the head commit's config sets it", (t) => {
  const screenshots = { when: ["apps/web/**"], uploader: "scripts/upload-evidence.mjs" };
  const repo = pullRequestRepo(t, {
    base: { ".standard/config.json": {} },
    head: { ".standard/config.json": { pr: { screenshots } }, "apps/web/page.tsx": "changed" },
  });
  git(repo.cwd, "switch", "-q", "develop");
  const runs = [run(1, { sha: repo.head })];
  const view = { headRefOid: repo.head, baseRefOid: repo.base };
  assertRefused(
    mergeWith(t, { cwd: repo.cwd, runs, view }),
    /^ {4}pr-screenshot: warning: Evidence: Evidence has no screenshot, but the PR changes apps\/web\/page\.tsx\. Upload one with scripts\/upload-evidence\.mjs\.$/m,
  );
  const shown = GOOD_BODY.replace("**After:** 0 fail.", "**After:** 0 fail.\n\n![after](https://example.com/after.png)");
  assert.equal(mergeWith(t, { cwd: repo.cwd, runs, view: { ...view, body: shown } }).merged.length, 1);
});

test("merge fetches a base or head commit the clone lacks from origin", (t) => {
  const origin = pullRequestRepo(t);
  const clone = tempDir(t, "clone");
  git(clone, "clone", "-q", origin.cwd, ".");
  git(origin.cwd, "switch", "-q", "develop");
  git(origin.cwd, "commit", "-q", "--allow-empty", "--no-verify", "-m", "Move develop past the clone");
  const base = git(origin.cwd, "rev-parse", "HEAD");
  const runs = [run(1, { sha: origin.head })];
  const view = { headRefOid: origin.head, baseRefOid: base };
  assert.equal(mergeWith(t, { cwd: clone, runs, view }).merged.length, 1);
});
