"use client";

import { createElement, useRef, useState, type ReactNode } from "react";
import useSWR, { SWRConfig, unstable_serialize, useSWRConfig, type SWRConfiguration } from "swr";

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
  const { mutate } = useSWRConfig();
  const { data, error, isValidating } = useSWR<Data, Error>(key, (current: Key) => fetcher(current), { ...revalidation, revalidateOnMount: !fresh });
  return {
    data: data === undefined ? fallbackData : data,
    error,
    validating: isValidating,
    async revalidate() {
      await mutate(key);
    },
    async replace(change, { revalidate = false } = {}) {
      await mutate<Data>(key, (current) => change(current === undefined ? fallbackData : current), { revalidate });
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

type NextPage = { list: string; status: "loading" } | { list: string; status: "failed"; error: Error };

export function useServerSeededInfinite<Key extends SeedKey, Page>(
  pageKey: (index: number, previous: Page | null) => Key | null,
  fetchPage: (key: Key) => Promise<Page>,
  options: SeededPagesOptions<Page>,
): SeededPages<Page> {
  const { fallbackData, fresh = false, ...revalidation } = options;
  const { cache, mutate } = useSWRConfig();
  const first = pageKey(0, null);
  const list = first === null ? null : (["$pages", first] as const);
  const id = unstable_serialize(list);
  const refresh = useRef<Promise<unknown>>(undefined);
  const [requested, setRequested] = useState<NextPage | null>(null);
  const keyAfter = (loaded: readonly Page[]) => pageKey(loaded.length, loaded.at(-1) ?? null);
  const refetchLoaded = async () => {
    const loaded: readonly Page[] = cache.get(id)?.data ?? fallbackData;
    const pages: Page[] = [];
    for (let key = first; key !== null && pages.length < Math.max(1, loaded.length); key = keyAfter(pages)) pages.push(await fetchPage(key));
    return pages;
  };
  const { data, error, isValidating } = useSWR<readonly Page[], Error>(list, () => (refresh.current = refetchLoaded()), { ...revalidation, revalidateOnMount: !fresh });
  const pages = data ?? fallbackData;
  const next = requested?.list === id ? requested : null;
  const loadingMore = next?.status === "loading";
  const failure = next?.status === "failed" ? next.error : undefined;
  const settle = (after: NextPage | null) => setRequested((now) => (now?.list === id ? after : now));
  const fetchNext = async () => {
    if (list === null || loadingMore) return;
    setRequested({ list: id, status: "loading" });
    try {
      await refresh.current?.catch(() => undefined);
      await mutate<readonly Page[]>(
        list,
        async (current) => {
          const loaded = current ?? fallbackData;
          const key = keyAfter(loaded);
          return key === null ? loaded : [...loaded, await fetchPage(key)];
        },
        { revalidate: false },
      );
      settle(null);
    } catch (thrown) {
      settle({ list: id, status: "failed", error: thrown instanceof Error ? thrown : new Error(String(thrown)) });
    }
  };
  return {
    pages,
    error: failure ?? error,
    validating: isValidating || loadingMore,
    loadingMore,
    done: keyAfter(pages) === null,
    loadMore() {
      void fetchNext();
    },
    async restart() {
      settle(null);
      await mutate<readonly Page[]>(list, (current) => (current ?? fallbackData).slice(0, 1), { revalidate: true });
    },
    async revalidate() {
      await (failure ? fetchNext() : mutate(list));
    },
    async replace(change, { revalidate = false } = {}) {
      await mutate<readonly Page[]>(list, (current) => change(current ?? fallbackData), { revalidate });
    },
  };
}

export function SwrScope({ children }: { children: ReactNode }): ReactNode {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}
