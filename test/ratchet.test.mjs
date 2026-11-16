import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { ratchet } from "../src/ratchet.mjs";
import { run as runChecks } from "../src/run.mjs";
import { loadRepo } from "../src/repo.mjs";
import { tempDir, tempRepo } from "./helpers.mjs";

function finding(group, key) {
  return { group, key, fix: `${key}: rename it` };
}

function run(t, { findings, baseline, mode = "check" }) {
  const path = join(tempDir(t, "ratchet"), "baselines/example.json");
  if (baseline !== undefined) {
    mkdirSync(dirname(path));
    writeFileSync(path, JSON.stringify(baseline));
  }
  const { failed, message } = ratchet({
    check: "example",
    path,
    shown: ".standard/baselines/example.json",
    findings,
    mode,
  });
  const after = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  return { failed, output: message, baseline: after };
}

const findings = [
  finding("summary", "a.ts"),
  finding("summary", "b.ts"),
  finding("summary", "b.ts"),
  finding("message", "c.ts"),
];
const baseline = { message: ["c.ts"], summary: ["a.ts", "b.ts", "b.ts"] };

test("passes when every finding is in the baseline", (t) => {
  const result = run(t, { findings, baseline });
  assert.equal(result.failed, false, result.output);
  assert.equal(result.output, "");
  assert.deepEqual(result.baseline, baseline);
});

test("fails on a new finding with the check's fix and leaves the baseline alone", (t) => {
  const result = run(t, { findings: [...findings, finding("summary", "d.ts")], baseline });
  assert.equal(result.failed, true);
  assert.match(result.output, /^1 new findings\.\n {2}d\.ts: rename it\n/);
  assert.match(result.output, /only shrinks, so never add to it/);
  assert.match(result.output, /standard check example --write re-keys it/);
  assert.deepEqual(result.baseline, baseline);
});

test("treats a second copy of a baselined key as new", (t) => {
  const result = run(t, { findings: [...findings, finding("message", "c.ts")], baseline });
  assert.equal(result.failed, true);
  assert.match(result.output, /1 new findings/);
});

test("matches findings by key and keeps the baseline's group labels", (t) => {
  const labelled = { "template-analysis": ["c.ts"] };
  const result = run(t, { findings: [finding("api:aggregate", "c.ts")], baseline: labelled });
  assert.equal(result.failed, false, result.output);
  assert.deepEqual(result.baseline, labelled);
  const shrunk = run(t, {
    findings: [finding("api:aggregate", "c.ts")],
    baseline: { "template-analysis": ["c.ts", "d.ts"] },
  });
  assert.deepEqual(shrunk.baseline, labelled);
});

test("fails once on fixed entries and rewrites the baseline without them", (t) => {
  const result = run(t, { findings: [finding("summary", "b.ts")], baseline });
  assert.equal(result.failed, true);
  assert.match(result.output, /3 baseline entries were fixed or moved/);
  assert.match(result.output, /message c\.ts: fixed/);
  assert.match(result.output, /summary b\.ts: 1 left/);
  assert.deepEqual(result.baseline, { summary: ["b.ts"] });
  const again = run(t, { findings: [finding("summary", "b.ts")], baseline: result.baseline });
  assert.equal(again.failed, false);
});

test("deletes the baseline when its last entry is fixed", (t) => {
  const result = run(t, { findings: [], baseline });
  assert.equal(result.failed, true);
  assert.match(result.output, /so this run deleted it/);
  assert.equal(result.baseline, undefined);
});

test("with no baseline file every finding is new", (t) => {
  const result = run(t, { findings: [finding("summary", "a.ts")] });
  assert.equal(result.failed, true);
  assert.match(result.output, /1 new findings/);
  assert.match(result.output, /has no baseline, so it allows none/);
  assert.doesNotMatch(result.output, /only shrinks/);
  assert.equal(result.baseline, undefined);
  assert.equal(run(t, { findings: [] }).failed, false);
});

test("--init starts a baseline only when none exists", (t) => {
  const started = run(t, { findings, mode: "init" });
  assert.equal(started.failed, false, started.output);
  assert.deepEqual(started.baseline, baseline);
  const again = run(t, { findings, baseline, mode: "init" });
  assert.equal(again.failed, true);
  assert.match(again.output, /already exists/);
  assert.equal(run(t, { findings: [], mode: "init" }).baseline, undefined);
});

test("--write re-keys a moved finding within its group", (t) => {
  const moved = [
    finding("summary", "a.ts"),
    finding("summary", "b.ts"),
    finding("summary", "renamed.ts"),
    finding("message", "c.ts"),
  ];
  const result = run(t, { findings: moved, baseline, mode: "write" });
  assert.equal(result.failed, false, result.output);
  assert.deepEqual(result.baseline, {
    message: ["c.ts"],
    summary: ["a.ts", "b.ts", "renamed.ts"],
  });
});

test("--write refuses to grow the baseline", (t) => {
  const result = run(t, {
    findings: [...findings, finding("message", "d.ts")],
    baseline,
    mode: "write",
  });
  assert.equal(result.failed, true);
  assert.match(result.output, /5 findings would grow .* past its 4 entries/);
  assert.match(result.output, /d\.ts: rename it/);
  assert.deepEqual(result.baseline, baseline);
});

test("--prune drops fixed entries and never adds new ones", (t) => {
  const result = run(t, {
    findings: [finding("summary", "a.ts"), finding("summary", "new.ts")],
    baseline,
    mode: "prune",
  });
  assert.equal(result.failed, false, result.output);
  assert.deepEqual(result.baseline, { summary: ["a.ts"] });
});

function treeCheck(found, applies = { on: true }) {
  return { name: "example", subject: "tree", retired: [], applies: () => applies, run: async () => found };
}

test("the runner ratchets a tree check against .standard/baselines in the repo", async (t) => {
  const repo = loadRepo(tempRepo(t));
  const scope = { commits: null };
  const stored = join(repo.root, ".standard/baselines/example.json");

  const [fresh] = await runChecks({ checks: [treeCheck([finding("summary", "a.ts")])], repo, scope });
  assert.equal(fresh.failed, true);
  assert.match(fresh.message, /1 new findings/);

  await runChecks({ checks: [treeCheck(findings)], repo, scope, names: ["example"], mode: "init" });
  assert.equal(readFileSync(stored, "utf8"), `${JSON.stringify(baseline, null, 2)}\n`);
  const [held] = await runChecks({ checks: [treeCheck(findings)], repo, scope });
  assert.deepEqual(held, { check: "example", outcome: "ran", findings: [], failed: false, message: "" });

  const [fixed] = await runChecks({ checks: [treeCheck([])], repo, scope });
  assert.equal(fixed.failed, true);
  assert.equal(existsSync(stored), false);
});

test("the runner skips a tree check that does not apply or is pending", async (t) => {
  const scope = { commits: null };
  const off = treeCheck([finding("summary", "a.ts")], { on: false, because: "no workspace has TypeScript" });
  assert.deepEqual(await runChecks({ checks: [off], repo: loadRepo(tempRepo(t)), scope }), [
    { check: "example", outcome: "skipped", because: "no workspace has TypeScript" },
  ]);
  const pending = loadRepo(tempRepo(t, { pending: ["example"] }));
  assert.deepEqual(await runChecks({ checks: [treeCheck([finding("summary", "a.ts")])], repo: pending, scope }), [
    { check: "example", outcome: "pending" },
  ]);
});
