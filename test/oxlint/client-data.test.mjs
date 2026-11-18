import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write, installPackage } from "../helpers.mjs";

function lint(t, files, { config, dirs = ["."] } = {}) {
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
  const diagnostics = lint(t, { "apps/liff/package.json": { dependencies: { react: "19", vite: "8" } }, "apps/liff/src/feature.tsx": SWR, "apps/web/package.json": NEXT, "apps/web/src/feature.tsx": SWR });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/web/src/feature.tsx"]);
});

test("client-data reads the legacy client-data list during adoption", (t) => {
  const diagnostics = lint(t, { "apps/web/package.json": NEXT, "apps/web/src/listed.tsx": SWR, "apps/web/src/other.tsx": SWR }, { config: { "client-data": [{ file: "apps/web/src/listed.tsx", reason: "pages" }] } });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), ["apps/web/src/other.tsx"]);
});
