"use client";

import { createElement, useState, type ReactNode } from "react";
import useSWR, {
  SWRConfig,
  unstable_serialize,
  useSWRConfig,
  type Cache,
  type SWRConfiguration,
} from "swr";
import { defaultConfigOptions, SWRGlobalState, type ProviderConfiguration } from "swr/_internal";

export type ServerDataKey = readonly [resource: string, ...parts: readonly unknown[]];

type Revalidation = Pick<
  SWRConfiguration,
  "refreshInterval" | "revalidateOnFocus" | "revalidateOnReconnect" | "keepPreviousData"
>;

type Mount = { fresh?: boolean; reuseCache?: boolean };

type Visit = { visit: true; fresh?: never; reuseCache?: never };

export type ServerDataOptions<Data> = Revalidation &
  ((Mount & { visit?: false }) | Visit) & { fallbackData: Data };

export type ServerData<Data> = {
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

type Ended = { cache: Cache; prefix: string };

const VISIT = "$visit";
let visits = 0;

const ended = new FinalizationRegistry<Ended>(({ cache, prefix }) => {
  const [revalidators, mutations, fetches, preloads] = SWRGlobalState.get(cache) ?? [];
  for (const id of [...cache.keys()].filter((id) => id.startsWith(prefix))) {
    cache.delete(id);
    if (revalidators?.[id]?.length === 0) delete revalidators[id];
    for (const records of [mutations, fetches, preloads]) if (records) delete records[id];
  }
});

function startVisit(cache: Cache): { id: string } {
  visits += 1;
  const visit = { id: String(visits) };
  ended.register(visit, { cache, prefix: unstable_serialize([VISIT, visit.id]) });
  return visit;
}

export function useServerData<Key extends ServerDataKey, Data>(
  key: Key | null,
  fetcher: (key: Key) => Promise<Data>,
  options: ServerDataOptions<Data>,
): ServerData<Data> {
  const {
    fallbackData,
    fresh = false,
    reuseCache = false,
    visit = false,
    ...revalidation
  } = options;
  const { cache, mutate } = useSWRConfig();
  const visitId = useState(() => (visit ? startVisit(cache) : null))[0]?.id;
  const swrKey = key === null || visitId === undefined ? key : ([VISIT, visitId, key] as const);
  const { data, error, isValidating } = useSWR<Data, Error>(
    swrKey,
    (current: readonly unknown[]) => fetcher((visitId === undefined ? current : current[2]) as Key),
    {
      ...revalidation,
      ...(visitId !== undefined
        ? { revalidateOnMount: true, revalidateIfStale: false }
        : {
            revalidateOnMount: revalidateOnMount(cache, unstable_serialize(key), {
              fresh,
              reuseCache,
            }),
          }),
    },
  );
  return {
    data: data === undefined ? fallbackData : data,
    error,
    validating: isValidating,
    async revalidate() {
      await mutate(swrKey);
    },
    async replace(change, { revalidate = false } = {}) {
      await mutate<Data>(
        swrKey,
        (current) => change(current === undefined ? fallbackData : current),
        {
          revalidate,
        },
      );
    },
  };
}

export type ServerDataPagesOptions<Page> = Revalidation & Mount & { fallbackData: readonly Page[] };

export type ServerDataPages<Page> = {
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

export function useServerDataPages<Key extends ServerDataKey, Page>(
  pageKey: (index: number, previous: Page | null) => Key | null,
  fetchPage: (key: Key) => Promise<Page>,
  options: ServerDataPagesOptions<Page>,
): ServerDataPages<Page> {
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

type Listen = ProviderConfiguration["initFocus"];

function releaseLatest(listen: Listen): Listen {
  let release: ReturnType<Listen>;
  return (callback) => {
    release = listen(callback);
    return () => release?.();
  };
}

function scope(): SWRConfiguration {
  return {
    provider: () => new Map(),
    initFocus: releaseLatest(defaultConfigOptions.initFocus),
    initReconnect: releaseLatest(defaultConfigOptions.initReconnect),
  };
}

export function ServerDataTestCache({ children }: { children: ReactNode }): ReactNode {
  const [value] = useState(scope);
  return createElement(SWRConfig, { value }, children);
}
