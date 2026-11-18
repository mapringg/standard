import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseConfig } from "../src/config.mjs";
import { registry } from "../src/registry.mjs";
import { buildSchema } from "../src/schema.mjs";
import { run } from "../src/run.mjs";
import { loadRepo } from "../src/repo.mjs";
import { git, standard, tempRepo, write } from "./helpers.mjs";

test("the schema is generated from the registered checks", () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL("../schema.json", import.meta.url))), buildSchema(registry));
});

test("rules accept oxlint severities and reject unknown keys and rules", () => {
  assert.equal(parseConfig('{"rules":{"docs":"warn"}}').rules.docs, "warn");
  for (const value of [{ rules: { config: "off" } }, { rules: { typo: "off" } }, { rules: { docs: "sometimes" } }, { $schema: "x", pending: [] }, { overrides: [{ files: [], rules: {} }] }]) {
    assert.throws(() => parseConfig(JSON.stringify(value)));
  }
});

test("rule severities and file overrides control real check findings", async (t) => {
  const root = tempRepo(t, { rules: { banned: "warn" }, overrides: [{ files: ["src/skip.ts"], rules: { banned: "off" } }] });
  write(root, { "src/skip.ts": 'import { useEffect } from "react";', "src/keep.ts": 'import { useEffect } from "react";' });
  git(root, "add", ".");
  const results = await run({ checks: registry, repo: loadRepo(root), scope: { commits: null, pr: null }, names: ["banned"] });
  assert.equal(results[0].failed, false);
  assert.equal(results[0].findings.length, 1);
  assert.equal(results[0].findings[0].advisory, true);
});

test("dead override globs fail even when selecting another check", (t) => {
  for (const files of [["missing/**"], ["src/clean.ts"]]) {
    const root = tempRepo(t, { overrides: [{ files, rules: { banned: "off" } }] });
    write(root, { "src/clean.ts": "export const value = 1;" });
    git(root, "add", ".");
    const result = standard(root, ["check", "banned"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /changes no findings|matches no files/);
  }
});

test("legacy config emits a migration notice and keeps its old checks working", (t) => {
  const root = tempRepo(t, { pending: ["banned"] });
  const result = standard(root, ["check", "banned"]);
  assert.equal(result.status, 0);
  assert.equal(result.migrationNotice, true);
});

test("modern docs budgets initialize from real docs and cannot grow", (t) => {
  const root = tempRepo(t, { rules: {} });
  write(root, { "README.md": "# Example\n" });
  git(root, "add", ".");
  const initialized = standard(root, ["check", "docs", "--init"]);
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  const budgets = JSON.parse(readFileSync(`${root}/.standard/baselines/docs.json`, "utf8"));
  assert.equal(budgets.readme, 1);
  write(root, { "README.md": "# Example\n\nMore text.\n" });
  const grown = standard(root, ["check", "docs", "--write"]);
  assert.equal(grown.status, 1);
  assert.match(grown.stderr, /may only go down/);
});

test("inherited object properties cannot masquerade as known config keys", () => {
  for (const key of ["__proto__", "constructor", "toString"]) {
    assert.throws(() => parseConfig(`{"rules":{"${key}":"off"}}`), /unknown key/);
  }
});

test("explicit error severity makes an advisory PR finding fail", async (t) => {
  const root = tempRepo(t, { rules: { "pr-body": "error" } });
  const result = await run({ checks: registry, repo: loadRepo(root), names: ["pr-body"], scope: { commits: null, pr: { number: 1, body: "empty" } } });
  assert.equal(result[0].failed, true);
});
