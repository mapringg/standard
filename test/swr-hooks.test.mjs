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
const { SwrScope, useServerSeeded, useServerSeededInfinite } = await import("../templates/swr.ts");

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

async function mount(t, useHook, props) {
  const result = { current: undefined };
  function Probe(probeProps) {
    result.current = useHook(probeProps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (next) => act(async () => root.render(createElement(SWRConfig, { value: { shouldRetryOnError: false } }, createElement(SwrScope, null, createElement(Probe, next)))));
  await render(props);
  t.after(() => act(async () => root.unmount()));
  return { result, rerender: render };
}

async function settle(until = () => false) {
  for (let waited = 0; waited < 300 && !until(); waited += 10) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

async function mountFirstPage(t, api) {
  const mounted = await mount(t, () => useServerSeededInfinite(pageKey, api.page, { fallbackData: [] }));
  await settle(() => mounted.result.current.pages.length === 1);
  await act(async () => mounted.result.current.revalidate());
  await settle(() => mounted.result.current.pages.length === 1);
  assert.deepEqual(mounted.result.current.pages.map((page) => page.index), [0]);
  return mounted;
}

test("a client-keyed list seeded with fallbackData [] loads on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerSeeded(["list", "mine"], api.list, { fallbackData: [] }));
  await settle(() => result.current.data.length > 0);
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["list", "mine"]], data: ["fetched mine"] });
});

test("a key that changes from null to a value loads", async (t) => {
  const api = server();
  const { result, rerender } = await mount(t, ({ id }) => useServerSeeded(id === null ? null : ["item", id], api.item, { fallbackData: null }), { id: null });
  await settle();
  assert.deepEqual(api.requests, []);
  await rerender({ id: "a" });
  await settle(() => result.current.data !== null);
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["item", "a"]], data: { id: "a", name: "fetched a" } });
});

test("a seeded hook marked fresh makes no request on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerSeeded(["item", "a"], api.item, { fallbackData: { id: "a", name: "seed" }, fresh: true }));
  await settle();
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [], data: { id: "a", name: "seed" } });
});

test("a seeded hook without fresh revalidates on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerSeeded(["item", "a"], api.item, { fallbackData: { id: "a", name: "seed" } }));
  assert.deepEqual(result.current.data, { id: "a", name: "seed" });
  await settle(() => result.current.data.name !== "seed");
  assert.deepEqual({ requests: api.requests, data: result.current.data }, { requests: [["item", "a"]], data: { id: "a", name: "fetched a" } });
});

test("a client-keyed page list seeded with fallbackData [] loads its first page on mount", async (t) => {
  const api = server();
  const { result } = await mount(t, () => useServerSeededInfinite(pageKey, api.page, { fallbackData: [] }));
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
  const { result } = await mount(t, () => useServerSeededInfinite(pageKey, api.page, { fallbackData: [{ index: 0, items: ["seed 0"] }], fresh: true }));
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
