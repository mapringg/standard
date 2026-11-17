"use client";

import { createElement, type ReactNode } from "react";
import useSWR, { SWRConfig, useSWRConfig, type SWRConfiguration } from "swr";
import useSWRInfinite from "swr/infinite";

export type SeedKey = readonly [resource: string, ...parts: readonly unknown[]];

export type Revalidation = Pick<SWRConfiguration, "refreshInterval" | "revalidateOnFocus" | "revalidateOnReconnect" | "keepPreviousData">;

export type SeededOptions<Data> = Revalidation & { fallbackData: Data; fresh?: boolean };

export type Seeded<Data> = {
  data: Data;
  error: Error | undefined;
  validating: boolean;
  revalidate(): Promise<void>;
  replace(change: (current: Data) => Data, options?: { revalidate?: boolean }): Promise<void>;
};

export function useServerSeeded<Key extends SeedKey, Data>(key: Key | null, fetcher: (key: Key) => Promise<Data>, options: SeededOptions<Data>): Seeded<Data> {
  const { fallbackData, fresh = false, ...revalidation } = options;
  const { data, error, isValidating, mutate } = useSWR<Data, Error>(key, (current: Key) => fetcher(current), { ...revalidation, revalidateOnMount: !fresh });
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

export type SeededPagesOptions<Page> = Revalidation & { fallbackData: readonly Page[]; fresh?: boolean };

export type SeededPages<Page> = {
  pages: readonly Page[];
  error: Error | undefined;
  validating: boolean;
  loadingMore: boolean;
  done: boolean;
  loadMore(): void;
  restart(): Promise<void>;
  revalidate(): Promise<void>;
  replace(change: (pages: readonly Page[]) => readonly Page[], options?: { revalidate?: boolean }): Promise<void>;
};

export function useServerSeededInfinite<Key extends SeedKey, Page>(
  pageKey: (index: number, previous: Page | null) => Key | null,
  fetchPage: (key: Key) => Promise<Page>,
  options: SeededPagesOptions<Page>,
): SeededPages<Page> {
  const { fallbackData, fresh = false, ...revalidation } = options;
  const { mutate: write } = useSWRConfig();
  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite<Page, Error>(pageKey, (key: Key) => fetchPage(key), {
    ...revalidation,
    initialSize: Math.max(1, fallbackData.length),
    revalidateOnMount: !fresh,
    revalidateFirstPage: false,
  });
  const pages = data ?? fallbackData;
  const seedPages = async () => {
    if (data !== undefined) return data;
    let previous: Page | null = null;
    for (const [index, page] of fallbackData.entries()) {
      await write(pageKey(index, previous), page, { revalidate: false });
      previous = page;
    }
    await mutate([...fallbackData], { revalidate: false });
    return fallbackData;
  };
  return {
    pages,
    error,
    validating: isValidating,
    loadingMore: isValidating && size > pages.length,
    done: pageKey(pages.length, pages[pages.length - 1] ?? null) === null,
    loadMore() {
      void seedPages().then(() => setSize(pages.length + 1));
    },
    async restart() {
      await setSize(1);
      await mutate();
    },
    async revalidate() {
      await mutate([...(await seedPages())]);
    },
    async replace(change, { revalidate = false } = {}) {
      await seedPages();
      await mutate((current) => [...change(current ?? fallbackData)], { revalidate });
    },
  };
}

export function SwrScope({ children }: { children: ReactNode }): ReactNode {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}
