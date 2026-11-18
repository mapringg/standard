import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import plugin from "../src/oxlint/rules.mjs";
import { registry } from "../src/registry.mjs";
import { standard } from "./helpers.mjs";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("the README rule table is what standard explain --markdown prints", () => {
  const table = /<!-- explain:start -->\n([\s\S]*?)<!-- explain:end -->/.exec(README)?.[1];
  const { stdout, status } = standard(process.cwd(), ["explain", "--markdown"]);
  assert.equal(status, 0);
  assert.equal(table, stdout, "Run standard explain --markdown and paste its output between the explain markers in README.md.");
});

test("explain --markdown has one row per check with its config, version and baseline", () => {
  const rows = standard(process.cwd(), ["explain", "--markdown"]).stdout.trimEnd().split("\n");
  assert.equal(rows.length, registry.length + 2);
  assert.match(rows.find((row) => row.startsWith("| `banned` |")) ?? "", /\| `banned` \| .+ \| .+ \| `banned`, `effect-wrappers` \| 0\.12\.0 \| yes \|$/);
  assert.match(rows.find((row) => row.startsWith("| `react` |")) ?? "", /\| none \| 0\.12\.0 \| no \|$/);
});

test("every check describes what it enforces and the fix it names", () => {
  for (const check of registry) {
    assert.ok(check.doc.enforces.trim().length > 0 && check.doc.fix.trim().length > 0, check.name);
  }
});

test("explain prints one line per check, and explain <check> prints it in full", () => {
  const lines = standard(process.cwd(), ["explain"]).stdout.trimEnd().split("\n");
  assert.deepEqual(lines.map((line) => line.split(" ")[0]), [...registry.map((check) => check.name), ...Object.keys(plugin.rules).map((name) => `standard/${name}`)]);
  assert.match(lines.find((line) => line.startsWith("pr-body")) ?? "", /^pr-body +0\.2\.0 +baseline-free +config: pr\.ticket-prefix +The description follows/);
  assert.match(lines.find((line) => line.startsWith("react")) ?? "", /^react +0\.12\.0 +baseline +config: none /);

  const { stdout, status } = standard(process.cwd(), ["explain", "dead-code"]);
  assert.equal(status, 0);
  assert.deepEqual(stdout.trimEnd().split("\n"), [
    "dead-code",
    "  Enforces: knip finds no unused file, export, type or dependency, and no unlisted dependency.",
    "  Fix: Delete the unused code or dependency, or add the missing one.",
    "  Config: none",
    "  Since: 0.8.0",
    "  Runs on: the tree",
    "  Baseline: none",
    "  Replaces: scripts/check-dead-code.mjs, scripts/check-dead-code.test.mjs, scripts/baselines/dead-code.json",
  ]);
});

test("explain keeps a warning-only check's baseline apart from whether it fails", () => {
  const { stdout } = standard(process.cwd(), ["explain", "pr-body"]);
  assert.match(stdout, /^  Enforces: .*It warns and never fails;/m);
  assert.match(stdout, /^  Baseline: none$/m);
  assert.doesNotMatch(stdout, /every finding fails/);
  assert.match(standard(process.cwd(), ["explain", "react"]).stdout, /^  Baseline: \.standard\/baselines\/react\.json records today's findings, and the check fails only new ones$/m);
});

test("explain refuses an unknown check and a flag other than --markdown", () => {
  const unknown = standard(process.cwd(), ["explain", "nope"]);
  assert.match(unknown.stderr, /^standard: explain names "nope", which is not a check or plugin rule in this version\. Checks: commit-subject, .+, config, standard\/zod, .+, standard\/ai-render\.\n$/);
  assert.equal(unknown.status, 1);
  const flag = standard(process.cwd(), ["explain", "--json"]);
  assert.match(flag.stderr, /^standard: explain takes one check name or --markdown\./);
  assert.equal(flag.status, 1);
});
