import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

test("memo is enforced in product code and skips tests", (t) => {
  const root = join(tempDir(t, "memo"), "scripts", "test", "repo");
  installPackage(root);
  const config = { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/memo": "error" }, categories: { correctness: "off" } };
  write(root, { "package.json": { type: "module", dependencies: { react: "19", vite: "8" } }, "oxlint.json": config, "src/feature.ts": "import { useMemo } from \"react\"; useMemo(() => 1, []);", "src/member.ts": 'import React from "react"; React.memo(() => null);', "src/lib/memo.ts": "export function owned() {}", "src/feature.test.ts": "import { useMemo } from \"react\"; useMemo(() => 1, []);" });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(diagnostics.length, 2, result.stdout);
  assert.deepEqual(diagnostics.map(({ filename }) => filename).sort(), ["src/feature.ts", "src/member.ts"]);

});
