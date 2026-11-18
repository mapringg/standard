import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { installPackage, tempDir, write } from "./helpers.mjs";

test("a consumer can spread the shared JSON config in oxlint.config.ts", (t) => {
  const root = tempDir(t, "spread-config");
  installPackage(root);
  write(root, {
    "package.json": { type: "module" },
    "oxlint.config.ts": 'import standard from "@mapringg/standard/oxlint-config" with { type: "json" }; export default { ...standard, options: { typeAware: false, typeCheck: false } };',
    "src/feature.ts": 'console.log("hello");',
  });
  const result = spawnSync(join(import.meta.dirname, "../node_modules/.bin/oxlint"), ["--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(diagnostics.some(({ code }) => code === "standard(log)"), result.stdout);
});
