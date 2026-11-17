import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { tempDir, write } from "./helpers.mjs";

const PACKAGE = join(import.meta.dirname, "..");

const USAGE = `"use client";

import type { ReactNode } from "react";
import useSWRBase, { type SWRResponse } from "swr";
import useSWRInfiniteBase, { type SWRInfiniteResponse } from "swr/infinite";

import { SWRTestCache, useSWR, useSWRInfinite } from "./lib/swr.ts";

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export const signatures: [Same<typeof useSWR, typeof useSWRBase>, Same<typeof useSWRInfinite, typeof useSWRInfiniteBase>] = [true, true];

type Item = { id: string; name: string };
type Page = { items: readonly Item[]; next: string | null };

declare function loadItem(key: readonly ["item", string]): Promise<Item>;
declare function loadPage(key: readonly ["items", string | null]): Promise<Page>;

export function useItem(id: string | null, seed: Item) {
  const item: SWRResponse<Item, Error> = useSWR<Item, Error>(id === null ? null : (["item", id] as const), loadItem, { fallbackData: seed, keepPreviousData: true });
  const { data, error, isLoading, isValidating, mutate } = item;
  const rename = (name: string) => mutate((current) => (current ? { ...current, name } : current), { revalidate: false });
  return { data, error, busy: isLoading || isValidating, rename };
}

export function useItems(seed: Page) {
  const list: SWRInfiniteResponse<Page, Error> = useSWRInfinite<Page, Error>((index, previous: Page | null) => (index > 0 && previous?.next == null ? null : (["items", previous?.next ?? null] as const)), loadPage, { fallbackData: [seed], revalidateOnFocus: true });
  const { data, size, setSize, mutate } = list;
  return { pages: data ?? [seed], more: () => setSize(size + 1), restart: () => setSize(1), refresh: () => mutate() };
}

export function Scope({ children }: { children: ReactNode }) {
  return <SWRTestCache>{children}</SWRTestCache>;
}
`;

test("the swr template passes the strict base and keeps the signatures of swr", (t) => {
  const root = tempDir(t, "swr");
  write(root, {
    "tsconfig.json": {
      extends: join(PACKAGE, "config/tsconfig.json"),
      compilerOptions: { noEmit: true, module: "preserve", target: "esnext", jsx: "preserve", lib: ["esnext", "dom"], allowImportingTsExtensions: true, types: [] },
      include: ["src"],
    },
    "src/usage.tsx": USAGE,
  });
  cpSync(join(PACKAGE, "templates/swr.ts"), join(root, "src/lib/swr.ts"));
  symlinkSync(join(PACKAGE, "node_modules"), join(root, "node_modules"));
  const { stdout, stderr, status } = spawnSync(process.execPath, [join(PACKAGE, "node_modules/typescript/bin/tsc"), "-p", root], { encoding: "utf8" });
  assert.deepEqual({ stdout, stderr, status }, { stdout: "", stderr: "", status: 0 });
});

function binary(name) {
  return join(PACKAGE, "node_modules/.bin", name);
}

test("oxfmt with the shared config leaves the swr template as shipped", () => {
  const { stdout, stderr, status } = spawnSync(binary("oxfmt"), ["--config", join(PACKAGE, "config/oxfmt.json"), "--check", join(PACKAGE, "templates/swr.ts")], { encoding: "utf8" });
  assert.equal(status, 0, stdout + stderr);
});

test("oxlint with the shared config and the react plugin finds nothing in the swr template", (t) => {
  const root = tempDir(t, "swr-lint");
  write(root, {
    ".oxlintrc.json": { extends: [join(PACKAGE, "config/oxlint.json")], plugins: ["react"] },
    "tsconfig.json": {
      extends: join(PACKAGE, "config/tsconfig.json"),
      compilerOptions: { noEmit: true, module: "preserve", target: "esnext", jsx: "preserve", lib: ["esnext", "dom"], types: [] },
      include: ["src"],
    },
  });
  cpSync(join(PACKAGE, "templates/swr.ts"), join(root, "src/lib/swr.ts"));
  symlinkSync(join(PACKAGE, "node_modules"), join(root, "node_modules"));
  const { stdout, stderr, status } = spawnSync(binary("oxlint"), ["src"], { cwd: root, encoding: "utf8" });
  assert.deepEqual({ stdout, stderr, status }, { stdout: "", stderr: "", status: 0 });
});

test("no package code imports swr", () => {
  const files = readdirSync(join(PACKAGE, "src"), { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".mjs"));
  assert.ok(files.length > 0);
  assert.deepEqual(files.filter((file) => /(?:from\s*|import\(\s*|require\(\s*)["']swr(?:\/[^"']*)?["']/.test(readFileSync(join(PACKAGE, "src", file), "utf8"))), []);
});
