"use client";

import { createElement, useState, type ReactNode } from "react";
import useSWRBase, { SWRConfig, type Key, type SWRConfiguration } from "swr";
import { defaultConfigOptions, normalize, type ProviderConfiguration } from "swr/_internal";
import useSWRInfiniteBase, {
  type SWRInfiniteConfiguration,
  type SWRInfiniteKeyLoader,
} from "swr/infinite";

const DEFAULTS = { revalidateOnFocus: false, revalidateOnReconnect: false };

export const useSWR = ((...args: Parameters<typeof normalize<Key, unknown>>[0]) => {
  const [key, fetcher, config] = normalize<Key, unknown>(args);
  return useSWRBase(key, fetcher, { ...DEFAULTS, ...config });
}) as typeof useSWRBase;

export const useSWRInfinite = ((
  ...args: Parameters<typeof normalize<SWRInfiniteKeyLoader, unknown>>[0]
) => {
  const [getKey, fetcher, config] = normalize<SWRInfiniteKeyLoader, unknown>(args);
  return useSWRInfiniteBase(getKey, fetcher, {
    ...DEFAULTS,
    ...config,
  } as SWRInfiniteConfiguration);
}) as typeof useSWRInfiniteBase;

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

export function SWRTestCache({ children }: { children: ReactNode }): ReactNode {
  const [value] = useState(scope);
  return createElement(SWRConfig, { value }, children);
}
