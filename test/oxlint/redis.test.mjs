import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

test("redis runs in oxlint and permits only its fixed owner", (t) => {
  const root = tempDir(t, "redis");
  installPackage(root);
  const config = { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/redis": "error" }, categories: { correctness: "off" } };
  write(root, { "package.json": { type: "module" }, "oxlint.json": config, "src/feature.ts": "import value from \"ioredis\"; value();", "src/lib/redis.ts": "import value from \"ioredis\"; value(); export function owned() {}", "src/feature.test.ts": "import value from \"ioredis\"; value();" });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(diagnostics.length, 1, result.stdout);
  assert.equal(diagnostics[0].filename, "src/feature.ts");
  assert.ok(diagnostics[0].message.startsWith("Import owned from "));
  assert.ok(diagnostics[0].message.includes("src/lib/redis.ts"));
});

test("redis catches literal import forms, subpaths and re-exports", (t) => {
  const root = tempDir(t, "redis-forms");
  installPackage(root);
  write(root, {
    "package.json": { type: "module" },
    "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/redis": "error" }, categories: { correctness: "off" } },
    "src/lib/redis.server.ts": "export function createClient() {}",
    "src/feature.ts": 'export { default } from "ioredis"; const client = require("redis/client"); import("redis");',
    "src/types.ts": 'import type { Redis } from "ioredis"; export type Client = Redis;',
  });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(diagnostics.length, 3, result.stdout + result.stderr);
  assert.ok(diagnostics.every(({ message }) => message.includes("createClient from src/lib/redis.server.ts")));
});
