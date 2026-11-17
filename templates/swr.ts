"use client";

// Copy this file to src/lib/swr.ts of each Next app. The react check allows swr imports only there.
import { createElement, type ReactNode } from "react";
import useSWR, { SWRConfig, type SWRConfiguration } from "swr";
import useSWRInfinite from "swr/infinite";

/** A cache key. Its first item names the resource. A null key pauses the request. */
export type SeedKey = readonly [resource: string, ...parts: readonly unknown[]];

/** The revalidation settings an app may change. This file fixes the rest. */
export type Revalidation = Pick<SWRConfiguration, "refreshInterval" | "revalidateOnFocus" | "revalidateOnReconnect" | "keepPreviousData">;

/** fallbackData is required, because the server component fetched it, so the first render has no loading state. */
export type SeededOptions<Data> = Revalidation & { fallbackData: Data };

export type Seeded<Data> = {
  /** Never undefined. It is the server's data until a revalidation lands. */
  data: Data;
  error: Error | undefined;
  validating: boolean;
  revalidate(): Promise<void>;
  /** Changes the cached data in place, for an optimistic or confirmed update. revalidate defaults to false. */
  replace(change: (current: Data) => Data, options?: { revalidate?: boolean }): Promise<void>;
};

export function useServerSeeded<Key extends SeedKey, Data>(key: Key | null, fetcher: (key: Key) => Promise<Data>, options: SeededOptions<Data>): Seeded<Data> {
  const { fallbackData, ...revalidation } = options;
  const { data, error, isValidating, mutate } = useSWR<Data, Error>(key, (current: Key) => fetcher(current), { ...revalidation, revalidateOnMount: false });
  return {
    data: data === undefined ? fallbackData : data,
    error,
    validating: isValidating,
    async revalidate() {
      await mutate();
    },
    async replace(change, { revalidate = false } = {}) {
      await mutate((current) => change(current === undefined ? fallbackData : current), { revalidate });
    },
  };
}

export type SeededPagesOptions<Page> = Revalidation & { fallbackData: readonly Page[] };

export type SeededPages<Page> = {
  /** Never undefined. It is the server's pages until a revalidation or a loadMore lands. */
  pages: readonly Page[];
  error: Error | undefined;
  validating: boolean;
  /** True while a loadMore request is in flight. */
  loadingMore: boolean;
  /** True when pageKey returns null for the next page. */
  done: boolean;
  loadMore(): void;
  /** Goes back to the first page and fetches it again. */
  restart(): Promise<void>;
  revalidate(): Promise<void>;
  replace(change: (pages: readonly Page[]) => readonly Page[], options?: { revalidate?: boolean }): Promise<void>;
};

export function useServerSeededInfinite<Key extends SeedKey, Page>(
  pageKey: (index: number, previous: Page | null) => Key | null,
  fetchPage: (key: Key) => Promise<Page>,
  options: SeededPagesOptions<Page>,
): SeededPages<Page> {
  const { fallbackData, ...revalidation } = options;
  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite<Page, Error>(pageKey, (key: Key) => fetchPage(key), {
    ...revalidation,
    initialSize: Math.max(1, fallbackData.length),
    revalidateOnMount: false,
  });
  const pages = data ?? fallbackData;
  return {
    pages,
    error,
    validating: isValidating,
    loadingMore: isValidating && size > pages.length,
    done: pageKey(pages.length, pages[pages.length - 1] ?? null) === null,
    loadMore() {
      void setSize(pages.length + 1);
    },
    async restart() {
      await setSize(1);
      await mutate();
    },
    async revalidate() {
      await mutate();
    },
    async replace(change, { revalidate = false } = {}) {
      await mutate((current) => [...change(current ?? fallbackData)], { revalidate });
    },
  };
}

/** Gives its subtree an empty cache, so each test starts clean. It is the one way a test reaches SWRConfig. */
export function SwrScope({ children }: { children: ReactNode }): ReactNode {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}
