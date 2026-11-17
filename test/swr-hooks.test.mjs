import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/", pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");
const { SWRConfig } = await import("swr");
const { ServerDataTestCache, useServerData, useServerDataPages } = await import("../templates/swr.ts");

function server(failing = new Set()) {
  const requests = [];
  return {
    requests,
    failing,
    async item(key) {
      requests.push(key);
      return { id: key[1], name: `fetched ${key[1]}` };
    },
    async list(key) {
      requests.push(key);
      return [`fetched ${key[1]}`];
    },
    async page(key) {
      requests.push(key);
      if (failing.delete(key[1])) throw new Error(`page ${key[1]} failed`);
      return { index: key[1], items: [`fetched ${key[1]}`] };
    },
  };
}

const pageKey = (index) => (index < 3 ? ["items", index] : null);

async function mount(t, useHook, props, config = {}) {
  const result = { first: undefined, current: undefined };
  function Probe(probeProps) {
    result.current = useHook(probeProps);
    result.first ??= result.current;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const tree = (next) => createElement(SWRConfig, { value: { shouldRetryOnError: false, ...config } }, createElement(ServerDataTestCache, null, next?.shown === false ? null : createElement(Probe, next)));
  const render = (next) => act(async () => root.render(tree(next)));
  await render(props);
  t.after(() => act(async () => root.unmount()));
  return { result, rerender: render, renderNow: (next) => flushSync(() => root.render(tree(next))) };
}

async function settle(until = () => false) {
  for (let waited = 0; waited < 300 && !until(); waited += 10) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

async function mountFirstPage(t, api) {
  const mounted = await mount(t, () => useServerDataPages(pageKey, api.page, { fallbackData: [] }));
  await settle(() => mounted.result.current.pages.length === 1);
  await act(async () => mounted.result.current.revalidate());
  await settle(() => mounted.result.current.pages.length === 1);
  assert.deepEqual(mounted.result.current.pages.map((page) => page.index), [0]);
  return mounted;
}

test("a client-keyed list seeded with fallbackData [] loads on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerData(["list", "mine"], api.list, { fallbackData: [] }));
  await settle(() => result.current.data.length > 0);
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["list", "mine"]], data: ["fetched mine"] });
});

test("a client-only item seeded with fallbackData null shows it as loading until the mount request answers", async (t) => {
  const requests = [];
  let answer;
  const load = (key) => {
    requests.push(key);
    return new Promise((resolve) => (answer = resolve));
  };
  const { result } = await mount(t, () => useServerSeeded(["item", "a"], load, { fallbackData: null }));
  assert.deepEqual({ requests, data: result.current.data, validating: result.current.validating }, { requests: [["item", "a"]], data: null, validating: true });
  await act(async () => answer({ id: "a", name: "fetched a" }));
  assert.deepEqual({ data: result.current.data, validating: result.current.validating }, { data: { id: "a", name: "fetched a" }, validating: false });
});

test("a key that changes from null to a value loads", async (t) => {
  const api = server();
  const { result, rerender } = await mount(t, ({ id }) => useServerData(id === null ? null : ["item", id], api.item, { fallbackData: null }), { id: null });
  await settle();
  assert.deepEqual(api.requests, []);
  await rerender({ id: "a" });
  await settle(() => result.current.data !== null);
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["item", "a"]], data: { id: "a", name: "fetched a" } });
});

test("a seeded hook marked fresh makes no request on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerData(["item", "a"], api.item, { fallbackData: { id: "a", name: "seed" }, fresh: true }));
  await settle();
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [], data: { id: "a", name: "seed" } });
});

test("a seeded hook without fresh revalidates on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerData(["item", "a"], api.item, { fallbackData: { id: "a", name: "seed" } }));
  assert.deepEqual(result.first.data, { id: "a", name: "seed" });
  await settle(() => result.current.data.name !== "seed");
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["item", "a"]], data: { id: "a", name: "fetched a" } });
});

test("a client-keyed page list seeded with fallbackData [] loads its first page on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerDataPages(pageKey, api.page, { fallbackData: [] }));
  await settle(() => result.current.pages.length > 0);
  assert.deepEqual({ requests: api.requests, pages: result.current.pages.map((page) => page.index) }, { requests: [["items", 0]], pages: [0] });
});

test("load more fetches only the next page", async (t) => {
  const api = server();
  const { result } = await mountFirstPage(t, api);
  api.requests.length = 0;
  await act(async () => result.current.loadMore());
  await settle(() => result.current.pages.length === 2);
  assert.deepEqual({ requests: api.requests, pages: result.current.pages.map((page) => page.index) }, { requests: [["items", 1]], pages: [0, 1] });
});

test("load more after a fresh seed fetches only the next page", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerDataPages(pageKey, api.page, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
  await settle();
  assert.deepEqual(api.requests, []);
  await act(async () => result.current.loadMore());
  await settle(() => result.current.pages.length === 2);
  assert.deepEqual({ requests: api.requests, pages: result.current.pages.map((page) => page.items[0]) }, { requests: [["items", 1]], pages: ["seed 0", "fetched 1"] });
});

test("try again after a failed page fetches only that page", async (t) => {
  const api = server(new Set([2]));
  const { result } = await mountFirstPage(t, api);
  await act(async () => result.current.loadMore());
  await settle(() => result.current.pages.length === 2);
  await act(async () => result.current.loadMore());
  await settle(() => result.current.error !== undefined);
  assert.equal(result.current.error?.message, "page 2 failed");
  assert.deepEqual(result.current.pages.map((page) => page.index), [0, 1]);
  api.requests.length = 0;
  await act(async () => result.current.revalidate());
  await settle(() => result.current.pages.length === 3);
  assert.deepEqual({ requests: api.requests, pages: result.current.pages.map((page) => page.index), error: result.current.error }, { requests: [["items", 2]], pages: [0, 1, 2], error: undefined });
});

const listKey = (id) => (index) => (index < 3 ? ["items", id, index] : null);
const firstItems = (result) => result.current.pages.map((page) => page.items[0]);

async function mountThreeTimes(t, useHook) {
  const { result, rerender } = await mount(t, useHook, { shown: true }, { dedupingInterval: 0 });
  const idle = async () => {
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await settle(() => !result.current.validating);
  };
  await idle();
  for (const shown of [false, true, false, true]) {
    await rerender({ shown });
    await idle();
  }
  return result;
}

const SEED = { id: "a", name: "seed" };

test("a hook with reuseCache fetches on its first mount and reuses the cached result when it mounts again", async (t) => {
  const api = server();
  const result = await mountThreeTimes(t, () => useServerData(["item", "a"], api.item, { fallbackData: SEED, reuseCache: true }));
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["item", "a"]], data: { id: "a", name: "fetched a" } });
});

test("a hook without reuseCache refetches each time it mounts", async (t) => {
  const api = server();
  const result = await mountThreeTimes(t, () => useServerData(["item", "a"], api.item, { fallbackData: SEED }));
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["item", "a"], ["item", "a"], ["item", "a"]], data: { id: "a", name: "fetched a" } });
});

test("a page list with reuseCache fetches on its first mount and reuses the cached pages when it mounts again", async (t) => {
  const api = server();
  const result = await mountThreeTimes(t, () => useServerDataPages(pageKey, api.page, { fallbackData: [], reuseCache: true }));
  assert.deepEqual({ requests: api.requests, pages: firstItems(result) }, { requests: [["items", 0]], pages: ["fetched 0"] });
});

test("a page list without reuseCache refetches each time it mounts", async (t) => {
  const api = server();
  const result = await mountThreeTimes(t, () => useServerDataPages(pageKey, api.page, { fallbackData: [] }));
  assert.deepEqual({ requests: api.requests, pages: firstItems(result) }, { requests: [["items", 0], ["items", 0], ["items", 0]], pages: ["fetched 0"] });
});

test("an edit to one page list never reaches the list selected next", async (t) => {
  const api = server();
  const { result, renderNow } = await mount(t, ({ id }) => useServerDataPages(listKey(id), api.page, { fallbackData: [{ index: id, items: [`seed ${id}`] }], fresh: true }), { id: "A" });
  await act(async () => {
    const edit = result.current.replace((pages) => pages.map((page) => ({ ...page, items: ["edited A"] })));
    renderNow({ id: "B" });
    await edit;
  });
  await settle(() => firstItems(result)[0] === "fetched B");
  assert.deepEqual(firstItems(result), ["fetched B"]);
});

test("a replace held from an earlier key never changes the item selected next", async (t) => {
  const api = server();
  const { result, rerender } = await mount(t, ({ id }) => useServerData(["item", id], api.item, { fallbackData: { id, name: "seed" }, fresh: true }), { id: "a" });
  const held = result.current;
  await rerender({ id: "b" });
  await settle(() => result.current.data.name === "fetched b");
  await act(async () => held.replace((item) => ({ ...item, name: "edited a" })));
  await settle();
  assert.deepEqual(result.current.data, { id: "b", name: "fetched b" });
});

test("load more during the mount refetch keeps the refetched page", async (t) => {
  const requests = [];
  let finishFirstPage;
  const fetchPage = (key) => {
    requests.push(key);
    if (key[1] > 0) return Promise.resolve({ index: key[1], items: [`fetched ${key[1]}`] });
    return new Promise((resolve) => {
      finishFirstPage = () => resolve({ index: 0, items: ["refetched 0"] });
    });
  };
  const { result } = await mount(t, () => useServerDataPages(pageKey, fetchPage, { fallbackData: [{ index: 0, items: ["seed 0"] }] }));
  await act(async () => result.current.loadMore());
  await settle(() => result.current.pages.length === 2);
  await act(async () => finishFirstPage());
  await settle(() => result.current.pages.length === 2 && firstItems(result)[0] !== "seed 0");
  assert.deepEqual({ requests, pages: firstItems(result) }, { requests: [["items", 0], ["items", 1]], pages: ["refetched 0", "fetched 1"] });
});

const refreshes = {
  focus: { options: { revalidateOnFocus: true }, start: () => window.dispatchEvent(new window.Event("focus")) },
  reconnect: { options: { revalidateOnReconnect: true }, start: () => window.dispatchEvent(new window.Event("online")) },
  interval: { options: {}, start: (rerender) => rerender({ refreshInterval: 30 }) },
};

for (const [name, { options, start }] of Object.entries(refreshes)) {
  test(`${name} refresh refetches every loaded page, and load more only the next`, async (t) => {
    const requests = [];
    let version = 1;
    const fetchPage = async (key) => {
      requests.push(key);
      return { index: key[1], items: [`v${version} page ${key[1]}`] };
    };
    const { result, rerender } = await mount(t, ({ refreshInterval }) => useServerDataPages(pageKey, fetchPage, { fallbackData: [{ index: 0, items: ["v1 page 0"] }], fresh: true, ...options, refreshInterval }), { refreshInterval: 0 }, { dedupingInterval: 0, focusThrottleInterval: 0 });
    await act(async () => result.current.loadMore());
    await settle(() => result.current.pages.length === 2);
    assert.deepEqual({ requests, pages: firstItems(result) }, { requests: [["items", 1]], pages: ["v1 page 0", "v1 page 1"] });
    version = 2;
    requests.length = 0;
    await act(async () => start(rerender));
    await settle(() => firstItems(result)[1] === "v2 page 1");
    assert.deepEqual({ requests: requests.slice(0, 2), pages: firstItems(result) }, { requests: [["items", 0], ["items", 1]], pages: ["v2 page 0", "v2 page 1"] });
  });
}

test("a local replacement survives load more", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerDataPages(pageKey, api.page, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
  await act(async () => result.current.replace((pages) => pages.map((page) => ({ ...page, items: ["edited 0"] }))));
  assert.deepEqual({ requests: api.requests, pages: firstItems(result) }, { requests: [], pages: ["edited 0"] });
  await act(async () => result.current.loadMore());
  await settle(() => result.current.pages.length === 2);
  assert.deepEqual({ requests: api.requests, pages: firstItems(result) }, { requests: [["items", 1]], pages: ["edited 0", "fetched 1"] });
});

function heldPages() {
  const requests = [];
  const held = new Map();
  return {
    requests,
    fetchPage(key) {
      requests.push(key);
      return new Promise((resolve) => held.set(key[1], (label) => resolve({ index: key[1], items: [`${label} ${key[1]}`] })));
    },
    finish: (index, label) => held.get(index)(label),
  };
}

test("an edit made while the next page loads keeps the edit and the page", async (t) => {
  const api = heldPages();
  const { result } = await mount(t, () => useServerDataPages(pageKey, api.fetchPage, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
  await act(async () => result.current.loadMore());
  await act(async () => result.current.replace((pages) => pages.map((page) => ({ ...page, items: ["edited 0"] }))));
  assert.deepEqual({ pages: firstItems(result), loadingMore: result.current.loadingMore }, { pages: ["edited 0"], loadingMore: true });
  await act(async () => api.finish(1, "fetched"));
  await settle(() => !result.current.loadingMore);
  assert.deepEqual({ requests: api.requests, pages: firstItems(result) }, { requests: [["items", 1]], pages: ["edited 0", "fetched 1"] });
});

const useTwoLists = (fetchPage, options) => ({ table: useServerDataPages(pageKey, fetchPage, options), toolbar: useServerDataPages(pageKey, fetchPage, options) });

test("load more from a second component keeps the mount refetch they share", async (t) => {
  const api = heldPages();
  const { result } = await mount(t, () => useTwoLists(api.fetchPage, { fallbackData: [{ index: 0, items: ["seed 0"] }] }));
  await act(async () => result.current.toolbar.loadMore());
  await act(async () => api.finish(0, "refetched"));
  await act(async () => api.finish(1, "fetched"));
  await settle(() => result.current.table.pages.length === 2);
  const shown = (list) => list.pages.map((page) => page.items[0]);
  assert.deepEqual({ requests: api.requests, table: shown(result.current.table), toolbar: shown(result.current.toolbar) }, { requests: [["items", 0], ["items", 1]], table: ["refetched 0", "fetched 1"], toolbar: ["refetched 0", "fetched 1"] });
});

test("load more from two components at once fetches the next page once", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useTwoLists(api.page, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
  await act(async () => {
    result.current.table.loadMore();
    result.current.toolbar.loadMore();
  });
  await settle(() => result.current.table.pages.length === 2);
  await settle();
  assert.deepEqual({ requests: api.requests, pages: result.current.toolbar.pages.map((page) => page.index) }, { requests: [["items", 1]], pages: [0, 1] });
});

test("a page list never writes to an item whose key looks like its own", async (t) => {
  const api = server();
  const { result } = await mount(t, () => ({
    item: useServerData(["$pages", ["items", 0]], api.item, { fallbackData: { id: "a", name: "seed" }, fresh: true }),
    list: useServerDataPages(pageKey, api.page, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }),
  }));
  await act(async () => result.current.list.loadMore());
  await settle(() => result.current.list.pages.length === 2);
  assert.deepEqual(result.current.item.data, { id: "a", name: "seed" });
});

test("restart while the next page loads ends with only the restarted first page", async (t) => {
  const api = heldPages();
  const { result } = await mount(t, () => useServerDataPages(pageKey, api.fetchPage, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
  await act(async () => result.current.loadMore());
  await act(async () => void result.current.restart());
  await act(async () => api.finish(0, "restarted"));
  await act(async () => api.finish(1, "fetched"));
  await settle();
  assert.deepEqual({ requests: api.requests, pages: firstItems(result), loadingMore: result.current.loadingMore }, { requests: [["items", 1], ["items", 0]], pages: ["restarted 0"], loadingMore: false });
});

function queuedPages() {
  const requests = [];
  const held = [];
  return {
    requests,
    fetchPage(key) {
      requests.push(key);
      if (key[1] === 0) return Promise.resolve({ index: 0, items: ["fetched 0"] });
      return new Promise((resolve, reject) => held.push({ resolve: () => resolve({ index: key[1], items: [`fetched ${key[1]}`] }), reject: (message) => reject(new Error(message)) }));
    },
    held,
  };
}

async function loadMoreAcrossRestart(t) {
  const api = queuedPages();
  const { result } = await mount(t, () => useServerDataPages(pageKey, api.fetchPage, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
  await act(async () => result.current.loadMore());
  await act(async () => result.current.restart());
  await settle(() => firstItems(result)[0] === "fetched 0");
  await act(async () => result.current.loadMore());
  await settle(() => api.held.length === 2);
  const [obsolete, current] = api.held;
  return { api, result, obsolete, current };
}

const loadState = (result) => ({ pages: firstItems(result), loadingMore: result.current.loadingMore, error: result.current.error?.message });

test("a load more from before a restart that succeeds late keeps the newer load more loading", async (t) => {
  const { api, result, obsolete } = await loadMoreAcrossRestart(t);
  await act(async () => obsolete.resolve());
  await settle();
  assert.deepEqual({ requests: api.requests, ...loadState(result) }, { requests: [["items", 1], ["items", 0], ["items", 1]], pages: ["fetched 0"], loadingMore: true, error: undefined });
});

test("a load more from before a restart that succeeds late keeps the error of the newer load more", async (t) => {
  const { result, obsolete, current } = await loadMoreAcrossRestart(t);
  await act(async () => current.reject("page 1 failed"));
  await settle(() => result.current.error !== undefined);
  await act(async () => obsolete.resolve());
  await settle();
  assert.deepEqual(loadState(result), { pages: ["fetched 0"], loadingMore: false, error: "page 1 failed" });
});

test("a load more from before a restart that fails late shows no error", async (t) => {
  const { result, obsolete, current } = await loadMoreAcrossRestart(t);
  await act(async () => obsolete.reject("obsolete page failed"));
  await settle();
  assert.deepEqual(loadState(result), { pages: ["fetched 0"], loadingMore: true, error: undefined });
  await act(async () => current.resolve());
  await settle(() => !result.current.loadingMore);
  assert.deepEqual(loadState(result), { pages: ["fetched 0", "fetched 1"], loadingMore: false, error: undefined });
});

test("a load more that fails late after another component restarts the list shows no error", async (t) => {
  const api = queuedPages();
  const { result } = await mount(t, () => useTwoLists(api.fetchPage, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
  await act(async () => result.current.table.loadMore());
  await act(async () => result.current.toolbar.restart());
  await act(async () => api.held[0].reject("obsolete page failed"));
  await settle(() => !result.current.table.loadingMore);
  assert.deepEqual({ table: result.current.table.error?.message, toolbar: result.current.toolbar.error?.message }, { table: undefined, toolbar: undefined });
});
