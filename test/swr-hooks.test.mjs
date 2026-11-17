import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/", pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SWRConfig } = await import("swr");
const { SWRTestCache, useSWR, useSWRInfinite } = await import("../templates/swr.ts");

function server() {
  const requests = [];
  return {
    requests,
    async item(key) {
      requests.push(key);
      return `fetched ${requests.length}`;
    },
  };
}

async function mount(t, useHook) {
  const result = { current: undefined };
  function Probe() {
    result.current = { ...useHook() };
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const config = { shouldRetryOnError: false, dedupingInterval: 0, focusThrottleInterval: 0 };
  await act(async () => root.render(createElement(SWRConfig, { value: config }, createElement(SWRTestCache, null, createElement(Probe)))));
  t.after(() => act(async () => root.unmount()));
  return result;
}

async function settle(until = () => false) {
  for (let waited = 0; waited < 300 && !until(); waited += 10) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

const refresh = async () => {
  for (const type of ["focus", "online"]) {
    await act(async () => window.dispatchEvent(new window.Event(type)));
    await settle();
  }
};

const hooks = {
  useSWR: { use: (api, options) => useSWR(["item", "a"], api.item, options), read: (result) => result.current.data },
  "useSWR with a key and options": { use: (api, options) => useSWR(["item", "a"], { fetcher: api.item, ...options }), read: (result) => result.current.data },
  useSWRInfinite: { use: (api, options) => useSWRInfinite((index) => ["item", index], api.item, options), read: (result) => result.current.data?.[0] },
};

for (const [name, { use, read }] of Object.entries(hooks)) {
  test(`${name} fetches on mount and ignores focus and reconnect by default`, async (t) => {
    const api = server();
    const result = await mount(t, () => use(api));
    await settle(() => read(result) !== undefined);
    await refresh();
    assert.deepEqual({ requests: api.requests.length, data: read(result) }, { requests: 1, data: "fetched 1" });
  });

  test(`${name} revalidates on focus and reconnect when the caller turns them on`, async (t) => {
    const api = server();
    const result = await mount(t, () => use(api, { revalidateOnFocus: true, revalidateOnReconnect: true }));
    await settle(() => read(result) !== undefined);
    await refresh();
    assert.equal(api.requests.length, 3);
  });
}

test("useSWR shows fallbackData first and returns swr's mutate", async (t) => {
  const api = server();
  const result = await mount(t, () => useSWR(["item", "a"], api.item, { fallbackData: "seed" }));
  assert.equal(result.current.data, "seed");
  await settle(() => result.current.data === "fetched 1");
  await act(async () => result.current.mutate("edited", { revalidate: false }));
  assert.deepEqual({ requests: api.requests.length, data: result.current.data, loading: result.current.isLoading }, { requests: 1, data: "edited", loading: false });
});

test("useSWRInfinite returns swr's size and setSize", async (t) => {
  const api = server();
  const result = await mount(t, () => useSWRInfinite((index) => (index < 3 ? ["item", index] : null), api.item));
  await settle(() => result.current.data?.length === 1);
  await act(async () => result.current.setSize(2));
  await settle(() => result.current.data?.length === 2);
  assert.deepEqual({ size: result.current.size, requests: api.requests }, { size: 2, requests: [["item", 0], ["item", 0], ["item", 1]] });
});
