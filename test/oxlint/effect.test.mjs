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
    "src/named.effect-subscribe.ts": body("useBefore(() => { const stop = target.subscribe(f); return () => stop(); }, []);"),
    "src/bound.effect-subscribe.ts": body("useEffect(() => { target.addEventListener('x', f); const cleanup = () => target.removeEventListener('x', f); return cleanup; }, []);"),
    "src/undefined.effect-subscribe.ts": body("useEffect(() => { if (!target) return undefined; return () => {}; }, []);"),
    "src/maybe.effect-subscribe.ts": body("useEffect(() => { let stop; if (target) stop = target.subscribe(f); return stop; }, []);"),
    "src/result.effect-subscribe.ts": body("useEffect(() => { const stop = target.subscribe(f); return stop; }, []);"),
    "src/missing.effect-subscribe.ts": body("useEffect(() => { target.addEventListener('x', f); }, []);"),
    "src/early.effect-subscribe.ts": body("useEffect(() => { if (!target) return; return () => {}; }, []);"),
    "src/expression.effect-subscribe.ts": body("useEffect(() => target.subscribe(f), []);"),
    "src/call.effect-subscribe.ts": body("useEffect(() => { return target.subscribe(f); }, []);"),
    "src/passed.effect-subscribe.ts": body("useEffect(subscribe, []);"),
    "src/sync.effect-sync.ts": body("useEffect(() => { target.addEventListener('x', f); }, []);"),
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/call.effect-subscribe.ts", "src/early.effect-subscribe.ts", "src/expression.effect-subscribe.ts", "src/maybe.effect-subscribe.ts", "src/missing.effect-subscribe.ts", "src/passed.effect-subscribe.ts", "src/result.effect-subscribe.ts", "src/undefined.effect-subscribe.ts"]);
  assert.equal(diagnostics[0].message, "Write the subscription inline and end every path with return () => unsubscribe(), or return a const that holds such a function.");
});

test("effect follows useInsertionEffect, re-exports and destructured namespaces", (t) => {
  const diagnostics = lint(t, "effect", {
    "src/insertion.ts": 'import { useInsertionEffect } from "react"; useInsertionEffect(() => {});',
    "src/reexport.effect-sync.ts": 'export { useEffect as useMounted } from "react";',
    "src/star.effect-sync.ts": 'export * from "react";',
    "src/local.effect-sync.ts": 'import { useEffect } from "react"; export { useEffect };',
    "src/destructure.ts": 'import * as React from "react"; const { useEffect: run } = React; run(() => {});',
    "src/default.ts": 'import React from "react"; const { useLayoutEffect } = React;',
    "src/state.ts": 'import * as React from "react"; const { useState } = React; useState(1);',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/default.ts", "src/destructure.ts", "src/insertion.ts", "src/local.effect-sync.ts", "src/reexport.effect-sync.ts", "src/star.effect-sync.ts"]);
  assert.equal(diagnostics.find(({ filename }) => filename === "src/reexport.effect-sync.ts").message, "Export the hook that calls the effect, never the effect hook itself, so every file that runs an effect carries an effect name.");
});

test("an effect hook is only ever called directly", (t) => {
  const diagnostics = lint(t, "effect", {
    "src/alias.effect-sync.ts": 'import { useEffect } from "react"; export const run = useEffect;',
    "src/default.effect-sync.ts": 'import { useEffect } from "react"; export default useEffect;',
    "src/member.effect-sync.ts": 'import * as React from "react"; const run = React.useEffect; run(() => {});',
    "src/bind.effect-sync.ts": 'import { useLayoutEffect } from "react"; useLayoutEffect.call(null, () => {});',
    "src/direct.effect-sync.ts": 'import * as React from "react"; import { useEffect } from "react"; export function useA() { useEffect(() => {}); React.useEffect(() => {}); }',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/alias.effect-sync.ts", "src/bind.effect-sync.ts", "src/default.effect-sync.ts", "src/member.effect-sync.ts"]);
  assert.ok(diagnostics.every(({ message }) => message.startsWith("Export the hook that calls the effect")), JSON.stringify(diagnostics));
});

test("effect-cleanup knows every hook form and rejects async effects", (t) => {
  const diagnostics = lint(t, "effect-cleanup", {
    "src/async.effect-subscribe.ts": 'import { useEffect } from "react"; export function useA(t) { useEffect(async () => { return () => t.off(); }, []); }',
    "src/destructured.effect-subscribe.ts": 'import * as React from "react"; const { useEffect: ue } = React; export function useA(t) { ue(() => { t.on(); }, []); }',
    "src/computed.effect-subscribe.ts": 'import React from "react"; export function useA(t) { React["useEffect"](() => { t.on(); }, []); }',
    "src/good.effect-subscribe.ts": 'import * as React from "react"; const { useEffect: ue } = React; export function useA(t) { ue(() => { t.on(); return () => t.off(); }, []); React["useLayoutEffect"](() => { return () => t.off(); }); }',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["src/async.effect-subscribe.ts", "src/computed.effect-subscribe.ts", "src/destructured.effect-subscribe.ts"]);
});
