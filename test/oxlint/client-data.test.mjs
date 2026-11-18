import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

function lint(t, files, { config, dirs = ["apps"] } = {}) {
  const root = tempDir(t, "client-data");
  installPackage(root);
  write(root, { "package.json": { type: "module" }, "oxlint.json": { jsPlugins: ["@mapringg/standard/oxlint"], categories: { correctness: "off" }, rules: { "standard/client-data": "error" } }, ...(config ? { ".standard/config.json": config } : {}), ...files });
  const result = spawnSync(join(import.meta.dirname, "../../node_modules/.bin/oxlint"), ["-c", "oxlint.json", "--format", "json", ...dirs], { cwd: root, encoding: "utf8" });
  assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
  return JSON.parse(result.stdout).diagnostics.sort((a, b) => a.filename.localeCompare(b.filename));
}

const NEXT = { dependencies: { next: "16", react: "19" } };
const SWR = 'import { useSWR } from "@/lib/swr"; export function useThing() { return useSWR("/x"); }';
const FETCH = '"use client"; export async function load() { return fetch("/x"); }';

test("client data loads only in .data-<reason> files", (t) => {
  const diagnostics = lint(t, {
    "apps/web/package.json": NEXT,
    "apps/web/src/feature.tsx": SWR,
    "apps/web/src/pages.data-pages.tsx": SWR,
    "apps/web/src/infinite.ts": 'import { useSWRInfinite } from "../lib/swr"; export const use = useSWRInfinite;',
    "apps/web/src/live.data-live.browser.ts": FETCH,
    "apps/web/src/client.tsx": FETCH,
    "apps/web/src/axios.tsx": '"use client"; import axios from "axios"; export const get = () => axios.get("/x");',
    "apps/web/src/api.tsx": '"use client"; import { load } from "@/lib/api/users"; export { load };',
    "apps/web/src/server.ts": 'export async function load() { return fetch("/x"); }',
    "apps/web/src/lib/api/users.ts": 'export async function load() { return fetch("/x"); }',
    "apps/web/src/lib/swr.ts": 'import useSWRBase from "swr"; export const useSWR = useSWRBase;',
    "apps/web/src/wrong.data-mount.tsx": SWR,
    "apps/web/src/feature.test.tsx": SWR,
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/web/src/api.tsx", "apps/web/src/axios.tsx", "apps/web/src/client.tsx", "apps/web/src/feature.tsx", "apps/web/src/infinite.ts", "apps/web/src/wrong.data-mount.tsx"]);
  assert.equal(diagnostics.find(({ filename }) => filename.endsWith("feature.tsx")).message, "Read the data in a Server Component and pass it down as props, or name the file apps/web/src/feature.data-<pages|live|client-state|unreachable>.tsx when the browser must load it.");
});

test("a Vite React app is unreachable as a whole", (t) => {
  const diagnostics = lint(t, { "apps/liff/package.json": { dependencies: { react: "19", vite: "8" } }, "apps/liff/vite.config.ts": "export default {};", "apps/liff/src/feature.tsx": SWR, "apps/web/package.json": NEXT, "apps/web/src/feature.tsx": SWR });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/web/src/feature.tsx"]);
});

test("client-data reads the legacy client-data list during adoption", (t) => {
  const diagnostics = lint(t, { "apps/web/package.json": NEXT, "apps/web/src/listed.tsx": SWR, "apps/web/src/other.tsx": SWR }, { config: { "client-data": [{ file: "apps/web/src/listed.tsx", reason: "pages" }] } });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/web/src/other.tsx"]);
});

test("client-data reports global members and streaming transports in browser code", (t) => {
  const diagnostics = lint(t, {
    "apps/web/package.json": NEXT,
    "apps/web/src/window.tsx": '"use client"; export const load = () => window.fetch("/x");',
    "apps/web/src/global.tsx": '"use client"; export const load = () => globalThis.fetch("/x");',
    "apps/web/src/self.tsx": '"use client"; export const load = () => self.fetch("/x");',
    "apps/web/src/events.tsx": '"use client"; export const open = () => new EventSource("/x");',
    "apps/web/src/socket.tsx": '"use client"; export const open = () => new WebSocket("/x");',
    "apps/web/src/server.ts": "export const load = () => globalThis.fetch(\"/x\");",
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/web/src/events.tsx", "apps/web/src/global.tsx", "apps/web/src/self.tsx", "apps/web/src/socket.tsx", "apps/web/src/window.tsx"]);
});

test("a Vite app needs index.html or a vite config beside its manifest", (t) => {
  const diagnostics = lint(t, { "apps/liff/package.json": { dependencies: { react: "19", vite: "8" } }, "apps/liff/index.html": "<div></div>", "apps/liff/src/feature.tsx": SWR, "apps/kit/package.json": { dependencies: { react: "19", vite: "8" } }, "apps/kit/src/feature.tsx": SWR });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/kit/src/feature.tsx"]);
});

test("the plugin ignores legacy lists in a config the CLI rejects", (t) => {
  const diagnostics = lint(t, { "apps/web/package.json": NEXT, "apps/web/src/listed.tsx": SWR }, { config: { $schema: "x", "client-data": [{ file: "apps/web/src/listed.tsx", reason: "pages" }] } });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/web/src/listed.tsx"]);
});

test("client-data follows computed, destructured and aliased globals, dynamic clients and react-query", (t) => {
  const diagnostics = lint(t, {
    "apps/web/package.json": NEXT,
    "apps/web/src/computed.tsx": '"use client"; export const load = () => window["fetch"]("/x");',
    "apps/web/src/destructured.tsx": '"use client"; const { fetch: f } = window; export const load = () => f("/x");',
    "apps/web/src/alias.tsx": '"use client"; const g = globalThis; export const load = () => g.fetch("/x");',
    "apps/web/src/dynamic.tsx": '"use client"; export const load = async () => (await import("ky")).default("/x");',
    "apps/web/src/required.tsx": '"use client"; const axios = require("axios"); export const load = () => axios.get("/x");',
    "apps/web/src/query.ts": 'import { useQuery, useInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query"; export const hooks = [useQuery, useInfiniteQuery, useSuspenseQuery];',
    "apps/web/src/location.tsx": '"use client"; export const here = () => typeof window === "undefined" || !("document" in globalThis) ? "" : window.location.href;',
    "apps/web/src/probe.tsx": '"use client"; export const can = () => "fetch" in window;',
    "apps/web/src/escape.tsx": '"use client"; export const target = () => window;',
  });
  assert.deepEqual([...new Set(diagnostics.map(({ filename }) => filename))], ["apps/web/src/alias.tsx", "apps/web/src/computed.tsx", "apps/web/src/destructured.tsx", "apps/web/src/dynamic.tsx", "apps/web/src/escape.tsx", "apps/web/src/probe.tsx", "apps/web/src/query.ts", "apps/web/src/required.tsx"]);
  assert.equal(diagnostics.filter(({ filename }) => filename.endsWith("query.ts")).length, 3);
});

test("client-data skips typeof probes and type positions", (t) => {
  const diagnostics = lint(t, {
    "apps/web/package.json": NEXT,
    "apps/web/src/probe.tsx": '"use client"; export const can = () => typeof globalThis.fetch === "function" && typeof window["WebSocket"] !== "undefined" && typeof fetch === "function";',
    "apps/web/src/typed.tsx": '"use client"; export type Fetch = typeof globalThis.fetch; export type Socket = typeof WebSocket; export let f: typeof window.fetch | undefined;',
    "apps/web/src/call.tsx": '"use client"; export const load = () => typeof globalThis.fetch("/x");',
  });
  assert.deepEqual([...new Set(diagnostics.map(({ filename }) => filename))], ["apps/web/src/call.tsx"]);
});
