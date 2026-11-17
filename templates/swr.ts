"use client";

import { createElement, useState, type ReactNode } from "react";
import useSWR, {
  SWRConfig,
  unstable_serialize,
  useSWRConfig,
  type Cache,
  type SWRConfiguration,
} from "swr";

export type SeedKey = readonly [resource: string, ...parts: readonly unknown[]];

export type Revalidation = Pick<
  SWRConfiguration,
  "refreshInterval" | "revalidateOnFocus" | "revalidateOnReconnect" | "keepPreviousData"
>;

type Mount = { fresh?: boolean; reuseCache?: boolean };

export type SeededOptions<Data> = Revalidation & Mount & { fallbackData: Data };

export type Seeded<Data> = {
  data: Data;
  error: Error | undefined;
  validating: boolean;
  revalidate(): Promise<void>;
  replace(change: (current: Data) => Data, options?: { revalidate?: boolean }): Promise<void>;
};

function revalidateOnMount(
  cache: Cache,
  id: string,
  { fresh, reuseCache }: Required<Mount>,
): boolean {
  return !fresh && !(reuseCache && cache.get(id)?.data !== undefined);
}

export function useServerSeeded<Key extends SeedKey, Data>(
  key: Key | null,
  fetcher: (key: Key) => Promise<Data>,
  options: SeededOptions<Data>,
): Seeded<Data> {
  const { fallbackData, fresh = false, reuseCache = false, ...revalidation } = options;
  const { cache, mutate } = useSWRConfig();
  const { data, error, isValidating } = useSWR<Data, Error>(
    key,
    (current: Key) => fetcher(current),
    {
      ...revalidation,
      revalidateOnMount: revalidateOnMount(cache, unstable_serialize(key), { fresh, reuseCache }),
    },
  );
  return {
    data: data === undefined ? fallbackData : data,
    error,
    validating: isValidating,
    async revalidate() {
      await mutate(key);
    },
    async replace(change, { revalidate = false } = {}) {
      await mutate<Data>(key, (current) => change(current === undefined ? fallbackData : current), {
        revalidate,
      });
    },
  };
}

export type SeededPagesOptions<Page> = Revalidation & Mount & { fallbackData: readonly Page[] };

export type SeededPages<Page> = {
  pages: readonly Page[];
  error: Error | undefined;
  validating: boolean;
  loadingMore: boolean;
  done: boolean;
  loadMore(): void;
  restart(): Promise<void>;
  revalidate(): Promise<void>;
  replace(
    change: (pages: readonly Page[]) => readonly Page[],
    options?: { revalidate?: boolean },
  ): Promise<void>;
};

type NextPage =
  | { list: string; status: "loading" }
  | { list: string; status: "failed"; error: Error };

type Flights = {
  refresh: Promise<unknown> | undefined;
  next: Promise<void> | undefined;
  restarts: number;
};

const PAGES = Symbol("pages");
const flightsByCache = new WeakMap<Cache, Map<string, Flights>>();

function flightsOf(cache: Cache, list: string): Flights {
  const lists = flightsByCache.get(cache) ?? new Map<string, Flights>();
  const flights = lists.get(list) ?? { refresh: undefined, next: undefined, restarts: 0 };
  flightsByCache.set(cache, lists.set(list, flights));
  return flights;
}

function startRefresh<Pages>(flights: Flights, refresh: Promise<Pages>): Promise<Pages> {
  flights.refresh = refresh;
  return refresh;
}

function joinNext(flights: Flights, append: (restarts: number) => Promise<void>): Promise<void> {
  const { restarts } = flights;
  flights.next ??= append(restarts).finally(() => {
    if (flights.restarts === restarts) flights.next = undefined;
  });
  return flights.next;
}

function dropNext(flights: Flights): void {
  flights.restarts += 1;
  flights.next = undefined;
}

export function useServerSeededInfinite<Key extends SeedKey, Page>(
  pageKey: (index: number, previous: Page | null) => Key | null,
  fetchPage: (key: Key) => Promise<Page>,
  options: SeededPagesOptions<Page>,
): SeededPages<Page> {
  const { fallbackData, fresh = false, reuseCache = false, ...revalidation } = options;
  const { cache, mutate } = useSWRConfig();
  const first = pageKey(0, null);
  const list = first === null ? null : ([PAGES, first] as const);
  const id = unstable_serialize(list);
  const flights = flightsOf(cache, id);
  const [requested, setRequested] = useState<NextPage | null>(null);
  const keyAfter = (loaded: readonly Page[]) => pageKey(loaded.length, loaded.at(-1) ?? null);
  const cached = (): readonly Page[] => cache.get(id)?.data ?? fallbackData;
  const refetchLoaded = async () => {
    const count = Math.max(1, cached().length);
    const pages: Page[] = [];
    for (let key = first; key !== null && pages.length < count; key = keyAfter(pages))
      pages.push(await fetchPage(key));
    return pages;
  };
  const { data, error, isValidating } = useSWR<readonly Page[], Error>(
    list,
    () => startRefresh(flights, refetchLoaded()),
    {
      ...revalidation,
      revalidateOnMount: revalidateOnMount(cache, id, { fresh, reuseCache }),
    },
  );
  const pages = data ?? fallbackData;
  const next = requested?.list === id ? requested : null;
  const loadingMore = next?.status === "loading";
  const failure = next?.status === "failed" ? next.error : undefined;
  const settle = (after: NextPage | null) =>
    setRequested((now) => (now?.list === id ? after : now));
  const appendNext = async (restarts: number) => {
    for (let appended = false; !appended;) {
      const key = keyAfter(cached());
      if (key === null) return;
      const page = await fetchPage(key);
      for (let settled; settled !== flights.refresh;)
        await (settled = flights.refresh)?.catch(() => undefined);
      if (flights.restarts !== restarts) return;
      await mutate<readonly Page[]>(
        list,
        (current) => {
          const loaded = current ?? fallbackData;
          appended = unstable_serialize(keyAfter(loaded)) === unstable_serialize(key);
          return appended ? [...loaded, page] : loaded;
        },
        { revalidate: false },
      );
    }
  };
  const fetchNext = async () => {
    if (list === null) return;
    const loading: NextPage = { list: id, status: "loading" };
    const finish = (after: NextPage | null) =>
      setRequested((now) => (now === loading ? after : now));
    const { restarts } = flights;
    setRequested(loading);
    try {
      await joinNext(flights, appendNext);
      finish(null);
    } catch (thrown) {
      const error = thrown instanceof Error ? thrown : new Error(String(thrown));
      finish(flights.restarts === restarts ? { list: id, status: "failed", error } : null);
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
      dropNext(flights);
      await mutate<readonly Page[]>(list, (current) => (current ?? fallbackData).slice(0, 1), {
        revalidate: true,
      });
    },
    async revalidate() {
      await (failure ? fetchNext() : mutate(list));
    },
    async replace(change, { revalidate = false } = {}) {
      await mutate<readonly Page[]>(list, (current) => change(current ?? fallbackData), {
        revalidate,
      });
    },
  };
}

export function SwrScope({ children }: { children: ReactNode }): ReactNode {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}
