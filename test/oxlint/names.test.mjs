import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";
import { parseName, withSegment } from "../../src/oxlint/roles.mjs";

test("a role segment names a known reason and sits before .browser, .server and .test", (t) => {
  const root = tempDir(t, "names");
  installPackage(root);
  const files = ["src/a.data-pages.tsx", "src/b.effect-sync.browser.ts", "src/c.data-unreachable.effect-route.tsx", "src/d.cache.ts", "src/e.data-mount.tsx", "src/f.browser.effect-sync.ts", "src/g.effect-mount.ts", "src/h.server.cache.ts", "src/i.cache.server.ts", "src/j.cache.tsx"];
  write(root, { "package.json": { type: "module" }, "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], categories: { correctness: "off" }, rules: { "standard/names": "error" } }, ...Object.fromEntries(files.map((file) => [file, "export const x = 1;"])) });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  const diagnostics = JSON.parse(result.stdout).diagnostics.sort((a, b) => a.filename.localeCompare(b.filename));
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/e.data-mount.tsx", "src/f.browser.effect-sync.ts", "src/g.effect-mount.ts", "src/h.server.cache.ts", "src/i.cache.server.ts", "src/j.cache.tsx"]);
  assert.equal(diagnostics[0].message, "Name the role as <name>.<role>-<reason> before .browser, .server and .test: data-pages, data-live, data-client-state, data-unreachable, effect-sync, effect-route, effect-subscribe, or <name>.cache.ts, which cached-modules matches.");
});

test("parseName reads roles and withSegment places them before variants", () => {
  assert.deepEqual(parseName("a/b.data-unreachable.effect-route.browser.tsx"), { data: ["unreachable"], effect: ["route"], cache: false, wrong: [] });
  assert.deepEqual(parseName("a/b.cache.ts"), { data: [], effect: [], cache: true, wrong: [] });
  assert.equal(withSegment("src/use-x.browser.test.ts", "effect-sync"), "src/use-x.effect-sync.browser.test.ts");
  assert.equal(withSegment("src/x.tsx", "data-live"), "src/x.data-live.tsx");
});
