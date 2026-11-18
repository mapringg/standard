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

test("the four-key config rejects severity controls and validates facts", () => {
  assert.equal(parseConfig('{"ticket":"ABC","skip":["cache-components"],"allow":{"standard/log":["src/old.ts"]}}').pr["ticket-prefix"], "ABC");
  for (const value of [{ ticket: 'ABC', pending: [] }, { skip: [], pr: {} }, { rules: {} }, { overrides: [] }, { allow: { typo: ["src/**"] } }, { skip: ["docs", "docs"] }, { ticket: "abc" }]) assert.throws(() => parseConfig(JSON.stringify(value)));
});

test("allow filters real findings and dead globs fail", async (t) => {
  const root = tempRepo(t, { allow: { banned: ["src/skip.ts"] } });
  write(root, { "src/skip.ts": 'import { useEffect } from "react";', "src/keep.ts": 'import { useEffect } from "react";' });
  git(root, "add", ".");
  const results = await run({ checks: registry, repo: loadRepo(root), scope: { commits: null, pr: null }, names: ["banned"] });
  assert.equal(results[0].check, "banned");
  assert.equal(results[0].failed, true);
  for (const config of [{ allow: { banned: ["missing/**"] } }, { allow: { banned: ["src/clean.ts"] } }, { skip: ["banned"], allow: { banned: ["src/skip.ts"] } }]) {
    write(root, { ".standard/config.json": config, "src/clean.ts": "export const value = 1;" });
    git(root, "add", ".");
    const result = standard(root, ["check", "banned"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /changes no findings|matches no files|skip/);
  }
});

test("plugin exceptions suppress findings and participate in the drift guard", (t) => {
  const root = tempRepo(t, { allow: { "standard/log": ["src/old.ts"] } });
  write(root, { "package.json": { type: "module" }, "src/old.ts": "console.log(1);" });
  git(root, "add", ".");
  assert.equal(standard(root, ["check", "config"]).status, 0);
  write(root, { "src/old.ts": "export const value = 1;" });
  assert.match(standard(root, ["check", "config"]).stdout, /changes no findings/);
});

test("oxlint cannot turn standard rules off through config or overrides", (t) => {
  for (const [path, config] of [[".oxlintrc.json", { overrides: [{ files: ["src/**"], rules: { "standard/log": "off" } }] }], ["oxlint.config.ts", 'export default { rules: { "standard/zod": [0] } };']]) {
    const root = tempRepo(t, {});
    write(root, { [path]: config });
    git(root, "add", ".");
    const result = standard(root, ["check", "config"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /allow/);
  }
});

test("commit-subject runs do not execute the tree drift guard", async (t) => {
  const root = tempRepo(t, { allow: { banned: ["missing/**"] } });
  git(root, "add", ".");
  const result = await run({ checks: registry, repo: loadRepo(root), names: ["commit-subject"], scope: { commits: [{ sha: null, subject: "Add a feature", body: "", parents: null, source: "message" }], pr: null } });
  assert.equal(result[0].check, "commit-subject");
  assert.equal(result[0].failed, false);
});

test("modern docs budgets initialize from real docs and cannot grow", (t) => {
  const root = tempRepo(t, {});
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


test("legacy facts emit a notice and cannot mix with modern keys", (t) => {
  const root = tempRepo(t, { pr: { "ticket-prefix": "ABC" }, pending: ["banned"] });
  const result = standard(root, ["check", "banned"]);
  assert.equal(result.status, 0);
  assert.equal(result.migrationNotice, true);
});

test("allow offers only tree checks and plugin rules", () => {
  for (const { name, subject } of registry) {
    if (subject !== "tree") assert.throws(() => parseConfig(JSON.stringify({ allow: { [name]: ["src/**"] } })), /unknown key/);
  }
});

test("a whole-tree allow cannot suppress pathless doc budget findings", (t) => {
  const root = tempRepo(t, { allow: { docs: ["**"] } });
  write(root, { "README.md": "# Example\n", ".standard/baselines/docs.json": { readme: 0 } });
  git(root, "add", ".");
  const result = standard(root, ["check", "config"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /changes no findings/);
});

test("oxlint allow severity cannot disable standard plugin rules", (t) => {
  const root = tempRepo(t, {});
  write(root, { ".oxlintrc.json": { rules: { "standard/log": "allow" } } });
  git(root, "add", ".");
  const result = standard(root, ["check", "config"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Keep standard\/log at error/);
});
