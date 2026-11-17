import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { tempDir, write } from "./helpers.mjs";

const PACKAGE = join(import.meta.dirname, "..");

const USAGE = `"use client";

import type { ReactNode } from "react";

import { SwrScope, useServerSeeded, useServerSeededInfinite } from "./lib/swr.ts";

type Item = { id: string; name: string };
type Page = { items: readonly Item[]; next: string | null };

declare function loadItem(key: readonly ["item", string]): Promise<Item>;
declare function loadPage(key: readonly ["items", string | null]): Promise<Page>;

export function useItem(id: string | null, seed: Item) {
  const item = useServerSeeded(id === null ? null : (["item", id] as const), loadItem, {
    fallbackData: seed,
    refreshInterval: 5000,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    keepPreviousData: true,
  });
  const name: string = item.data.name;
  const failure: Error | undefined = item.error;
  const busy: boolean = item.validating;
  const rename = (next: string) => item.replace((current) => ({ ...current, name: next }), { revalidate: true });
  return { name, failure, busy, rename, refresh: item.revalidate };
}

export function useItems(seed: readonly Page[]) {
  const list = useServerSeededInfinite((index, previous: Page | null) => (index > 0 && previous?.next == null ? null : (["items", previous?.next ?? null] as const)), loadPage, {
    fallbackData: seed,
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
  const names: string[] = list.pages.flatMap((page) => page.items.map((item) => item.name));
  const flags: boolean[] = [list.validating, list.loadingMore, list.done];
  const failure: Error | undefined = list.error;
  const drop = (id: string) => list.replace((pages) => pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== id) })));
  return { names, flags, failure, drop, more: list.loadMore, restart: list.restart, refresh: list.revalidate };
}

export function useUnseeded(id: string) {
  // @ts-expect-error fallbackData is required.
  const item = useServerSeeded(["item", id] as const, loadItem, { refreshInterval: 5000 });
  // @ts-expect-error fallbackData is required.
  const list = useServerSeededInfinite(() => ["items", null] as const, loadPage, {});
  // @ts-expect-error The wrapper fixes every setting outside Revalidation.
  const eager = useServerSeeded(["item", id] as const, loadItem, { fallbackData: { id, name: "" }, revalidateOnMount: true });
  return [item, list, eager];
}

export function Scope({ children }: { children: ReactNode }) {
  return <SwrScope>{children}</SwrScope>;
}
`;

test("the swr template passes the strict base and requires fallbackData", (t) => {
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

test("no package code imports swr", () => {
  const files = readdirSync(join(PACKAGE, "src"), { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".mjs"));
  assert.ok(files.length > 0);
  assert.deepEqual(files.filter((file) => /(?:from\s*|import\(\s*|require\(\s*)["']swr(?:\/[^"']*)?["']/.test(readFileSync(join(PACKAGE, "src", file), "utf8"))), []);
});
