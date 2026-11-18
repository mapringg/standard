import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

test("ai runs in oxlint and permits only its fixed owner", (t) => {
  const root = tempDir(t, "ai");
  installPackage(root);
  const config = { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/ai": "error" }, categories: { correctness: "off" } };
  write(root, { "package.json": { type: "module" }, "oxlint.json": config, "src/feature.ts": "import value from \"@ai-sdk/example\"; value();", "src/lib/ai.ts": "import value from \"@ai-sdk/example\"; value(); export function owned() {}", "src/feature.test.ts": "import value from \"@ai-sdk/example\"; value();" });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(diagnostics.length, 1, result.stdout);
  assert.equal(diagnostics[0].filename, "src/feature.ts");
  assert.ok(diagnostics[0].message.startsWith("Import owned from "));
  assert.ok(diagnostics[0].message.includes("src/lib/ai.ts"));
});
