import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

function lint(t, rule, files, config) {
  const root = tempDir(t, rule);
  installPackage(root);
  write(root, { "package.json": { type: "module", dependencies: { react: "19", next: "16" } }, "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], categories: { correctness: "off" }, rules: { [`standard/${rule}`]: "error" } }, ...(config ? { ".standard/config.json": config } : {}), ...files });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", "src"], { cwd: root, encoding: "utf8" });
  assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
  return JSON.parse(result.stdout).diagnostics.sort((a, b) => a.filename.localeCompare(b.filename));
}

const EFFECT = 'import { useEffect } from "react"; export function useThing() { useEffect(() => {}, []); }';

test("effect hooks run only in .effect-<reason> files, the timer owner and tests", (t) => {
  const diagnostics = lint(t, "effect", {
    "src/feature.tsx": EFFECT,
    "src/layout.ts": 'import * as React from "react"; export function useThing() { React.useLayoutEffect(() => {}); }',
    "src/map.effect-sync.browser.ts": EFFECT,
    "src/route.effect-route.tsx": EFFECT,
    "src/listener.effect-subscribe.ts": EFFECT,
    "src/wrong.effect-mount.ts": EFFECT,
    "src/lib/timer.ts": EFFECT,
    "src/feature.test.tsx": EFFECT,
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/feature.tsx", "src/layout.ts", "src/wrong.effect-mount.ts"]);
  assert.equal(diagnostics[0].message, "Replace the effect with what it does, or name the file src/feature.effect-<sync|route|subscribe>.tsx when it keeps an outside system in step, reacts to the route or subscribes.");
});

test("effect reads the legacy effect-wrappers list during adoption", (t) => {
  const diagnostics = lint(t, "effect", { "src/listed.ts": EFFECT, "src/other.ts": EFFECT }, { "effect-wrappers": [{ file: "src/listed.ts", reason: "Binds the map." }] });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/other.ts"]);
});

test("an effect-subscribe effect returns its cleanup on every path", (t) => {
  const body = (effect) => `import { useEffect, useLayoutEffect as useBefore } from "react"; export function useThing(target) { ${effect} }`;
  const diagnostics = lint(t, "effect-cleanup", {
    "src/arrow.effect-subscribe.ts": body("useEffect(() => { target.addEventListener('x', f); return () => target.removeEventListener('x', f); }, []);"),
    "src/named.effect-subscribe.ts": body("useBefore(() => { const stop = target.subscribe(f); return stop; }, []);"),
    "src/missing.effect-subscribe.ts": body("useEffect(() => { target.addEventListener('x', f); }, []);"),
    "src/early.effect-subscribe.ts": body("useEffect(() => { if (!target) return; return () => {}; }, []);"),
    "src/expression.effect-subscribe.ts": body("useEffect(() => target.subscribe(f), []);"),
    "src/call.effect-subscribe.ts": body("useEffect(() => { return target.subscribe(f); }, []);"),
    "src/passed.effect-subscribe.ts": body("useEffect(subscribe, []);"),
    "src/sync.effect-sync.ts": body("useEffect(() => { target.addEventListener('x', f); }, []);"),
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/call.effect-subscribe.ts", "src/early.effect-subscribe.ts", "src/expression.effect-subscribe.ts", "src/missing.effect-subscribe.ts", "src/passed.effect-subscribe.ts"]);
  assert.equal(diagnostics[0].message, "Write the subscription inline and return its cleanup on every path, as a function or the name of one: return () => target.removeEventListener(...) or return unsubscribe.");
});
