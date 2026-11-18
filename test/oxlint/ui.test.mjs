import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

test("ui runs in oxlint and permits only its fixed owner", (t) => {
  const root = tempDir(t, "ui");
  installPackage(root);
  const config = { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/ui": "error" }, categories: { correctness: "off" } };
  write(root, { "package.json": { type: "module" }, "oxlint.json": config, "src/feature.ts": "import value from \"@base-ui/react\"; value();", "src/components/ui/button.tsx": "import value from \"@base-ui/react\"; value(); export function owned() {}", "src/feature.test.ts": "import value from \"@base-ui/react\"; value();" });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(diagnostics.length, 1, result.stdout);
  assert.equal(diagnostics[0].filename, "src/feature.ts");
  assert.ok(diagnostics[0].message.includes("Import owned from src/components/ui/button.tsx"));
});
