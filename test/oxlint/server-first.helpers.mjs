import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tempDir, write, installPackage } from "../helpers.mjs";

export function lint(t, rule, files) {
  const root = tempDir(t, rule);
  installPackage(root);
  write(root, { "package.json": { type: "module" }, "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], categories: { correctness: "off" }, rules: { [`standard/${rule}`]: "error" } }, "apps/web/package.json": { dependencies: { next: "16", react: "19" } }, "apps/web/tsconfig.json": { compilerOptions: { paths: { "@/*": ["./src/*"] } } }, ...files });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "apps"], { cwd: root, encoding: "utf8" });
  assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
  return JSON.parse(result.stdout).diagnostics.sort((a, b) => a.filename.localeCompare(b.filename) || a.labels[0].span.offset - b.labels[0].span.offset);
}
