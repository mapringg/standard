import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

test("log runs in oxlint and permits only its fixed owner", (t) => {
  const root = tempDir(t, "log");
  installPackage(root);
  const config = { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/log": "error" }, categories: { correctness: "off" } };
  write(root, { "package.json": { type: "module" }, "oxlint.json": config, "src/feature.ts": "console.log(\"x\");", "src/lib/log.ts": "console.log(\"x\"); export function owned() {}", "src/lib/log.server.ts": "console.log(1); export const serverLog = console.log;", "src/lib/log.browser.ts": "console.log(1); export const browserLog = console.log;", "src/feature.test.ts": "console.log(\"x\");" });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(diagnostics.length, 1, result.stdout);
  assert.equal(diagnostics[0].filename, "src/feature.ts");
  assert.ok(diagnostics[0].message.startsWith("Import owned from "));
  assert.ok(diagnostics[0].message.includes("src/lib/log.ts"));
});

test("allow suppresses only the selected plugin files", (t) => {
  const root = tempDir(t, "allow-log");
  installPackage(root);
  write(root, { "package.json": { type: "module" }, ".standard/config.json": { allow: { "standard/log": ["src/old.ts"] } }, "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], categories: { correctness: "off" }, rules: { "standard/log": "error" } }, "src/old.ts": "console.log(1)", "src/new.ts": "console.log(2)" });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  assert.deepEqual(JSON.parse(result.stdout).diagnostics.map(({ filename }) => filename), ["src/new.ts"]);
});
