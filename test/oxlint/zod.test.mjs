import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

test("zod is enforced in product code and skips tests", (t) => {
  const root = join(tempDir(t, "zod"), "scripts", "test", "repo");
  installPackage(root);
  const config = { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/zod": "error" }, categories: { correctness: "off" } };
  write(root, { "package.json": { type: "module", dependencies: { react: "19", vite: "8" } }, "oxlint.json": config, "index.html": "<div></div>", "src/feature.ts": "import { z } from \"zod\"; z.string();", "src/subpath.ts": 'import { z } from "zod/v4"; z.string();', "src/lib/zod.ts": "export function owned() {}", "src/feature.test.ts": "import { z } from \"zod\"; z.string();" });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics;
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(diagnostics.length, 2, result.stdout);
  assert.deepEqual(diagnostics.map(({ filename }) => filename).sort(), ["src/feature.ts", "src/subpath.ts"]);

});

test("zod mini follows browser imports and exempts server-only code", (t) => {
  const root = tempDir(t, "zod-browser");
  installPackage(root);
  write(root, {
    "package.json": { type: "module" },
    "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], categories: { correctness: "off" }, rules: { "standard/zod": "error" } },
    "apps/web/package.json": { dependencies: { next: "16", react: "19" } },
    "apps/web/src/client.ts": '"use client"; import { value } from "../../../shared/value"; export { value };',
    "apps/web/src/page.ts": 'import { z } from "zod"; export const schema = z.string();',
    "apps/api/package.json": { type: "module" },
    "apps/api/src/main.ts": 'import { z } from "zod"; z.string();',
    "shared/value.ts": 'import { z } from "zod"; export const value = z.string();',
  });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "apps", "shared"], { cwd: root, encoding: "utf8" });
  assert.deepEqual(JSON.parse(result.stdout).diagnostics.map(({ filename }) => filename), ["shared/value.ts"]);
});

function browserDiagnostics(t, files, manifest = { type: "module" }) {
  const root = tempDir(t, "browser-edges");
  installPackage(root);
  write(root, { "package.json": manifest, "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], categories: { correctness: "off" }, rules: { "standard/zod": "error" } }, ...files });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "."], { cwd: root, encoding: "utf8" });
  assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
  return JSON.parse(result.stdout).diagnostics.map(({ filename }) => filename).sort();
}

test("browser reach follows two hops of shared value imports", (t) => {
  assert.deepEqual(browserDiagnostics(t, {
    "src/client.ts": '"use client"; import { value } from "../shared/first"; export { value };',
    "shared/first.ts": 'export { value } from "./second";',
    "shared/second.ts": 'import { z } from "zod"; export const value = z.string();',
  }), ["shared/second.ts"]);
});

test("browser reach stops at use server modules", (t) => {
  assert.deepEqual(browserDiagnostics(t, {
    "src/client.ts": '"use client"; import { action } from "../shared/action"; export { action };',
    "shared/action.ts": '"use server"; import { value } from "./secret"; export async function action() { return value; }',
    "shared/secret.ts": 'import { z } from "zod"; export const value = z.string();',
  }), []);
});

test("browser reach ignores type-only imports and exports", (t) => {
  assert.deepEqual(browserDiagnostics(t, {
    "src/client.ts": '"use client"; import type { Value } from "../shared/imported"; export type { Value as Other } from "../shared/exported"; export type Local = Value;',
    "shared/imported.ts": 'import { z } from "zod"; export type Value = string; export const schema = z.string();',
    "shared/exported.ts": 'import { z } from "zod"; export type Value = string; export const schema = z.string();',
  }), []);
});

test("Vite browser seeds are confined to src", (t) => {
  assert.deepEqual(browserDiagnostics(t, {
    "src/schema.ts": 'import { z } from "zod"; export const schema = z.string();',
    "runtime/schema.ts": 'import { z } from "zod"; export const schema = z.string();',
    "index.html": "<div></div>",
  }, { type: "module", dependencies: { react: "19", vite: "8" } }), ["src/schema.ts"]);
});

test("a Vite dependency without index.html or a vite config seeds no browser code", (t) => {
  assert.deepEqual(browserDiagnostics(t, {
    "src/schema.ts": 'import { z } from "zod"; export const schema = z.string();',
  }, { type: "module", dependencies: { react: "19", vite: "8" } }), []);
});
