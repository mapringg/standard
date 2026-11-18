import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");

test("pnpm typecheck runs strict checkJs over bin and src with node types and passes", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(manifest.scripts.typecheck, "tsc -p tsconfig.json");
  const config = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8"));
  assert.deepEqual(config.compilerOptions.types, ["node"]);
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.checkJs, true);
  const run = spawnSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
