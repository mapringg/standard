import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

test("zod is enforced in product code and skips tests", (t) => {
  const root = join(tempDir(t, "zod"), "scripts", "test", "repo");
  installPackage(root);
  const config = { jsPlugins: ["@mapringg/standard/oxlint"], rules: { "standard/zod": "error" }, categories: { correctness: "off" } };
  write(root, { "package.json": { type: "module", dependencies: { react: "19", vite: "8" } }, "oxlint.json": config, "src/feature.ts": "import { z } from \"zod\"; z.string();", "src/subpath.ts": 'import { z } from "zod/v4"; z.string();', "src/lib/zod.ts": "export function owned() {}", "src/feature.test.ts": "import { z } from \"zod\"; z.string();" });
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
