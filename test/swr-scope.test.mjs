import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/", pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EVENTS = ["visibilitychange", "focus", "online", "offline"];
const live = new Map(EVENTS.map((type) => [type, new Set()]));
for (const target of [dom.window, dom.window.document]) {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {
    live.get(type)?.add(listener);
    add(type, listener, options);
  };
  target.removeEventListener = (type, listener, options) => {
    live.get(type)?.delete(listener);
    remove(type, listener, options);
  };
}

const { act, Activity, createElement, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SWRConfig } = await import("swr");
const { SwrScope, useServerSeeded } = await import("../templates/swr.ts");

function since() {
  const before = new Map(EVENTS.map((type) => [type, new Set(live.get(type))]));
  return () => Object.fromEntries(EVENTS.map((type) => [type, [...live.get(type)].filter((listener) => !before.get(type).has(listener)).length]));
}
const NONE = Object.fromEntries(EVENTS.map((type) => [type, 0]));

function server() {
  const requests = [];
  return {
    requests,
    async item(key) {
      requests.push(key);
      return { id: key[1], name: `fetched ${requests.length}` };
    },
  };
}

function scope(api, options = {}) {
  function Probe() {
    useServerSeeded(["item", "a"], api.item, { fallbackData: null, ...options });
    return null;
  }
  return createElement(SWRConfig, { value: { shouldRetryOnError: false, dedupingInterval: 0, focusThrottleInterval: 0 } }, createElement(SwrScope, null, createElement(Probe)));
}

async function settle() {
  for (let waited = 0; waited < 50; waited += 10) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

test("a StrictMode scope removes every focus and network listener it added when it unmounts", async () => {
  const api = server();
  const listening = since();
  const root = createRoot(document.createElement("div"));
  for (let lifetime = 0; lifetime < 3; lifetime += 1) {
    await act(async () => root.render(createElement(StrictMode, null, createElement("div", { key: lifetime }, scope(api)))));
    await settle();
    assert.deepEqual(listening(), { visibilitychange: 1, focus: 1, online: 1, offline: 1 });
  }
  await act(async () => root.unmount());
  assert.deepEqual({ requests: api.requests.length, listening: listening() }, { requests: 3, listening: NONE });
});

test("a scope inside an Activity that hides, shows and unmounts removes every listener it added", async () => {
  const api = server();
  const listening = since();
  const root = createRoot(document.createElement("div"));
  const kept = scope(api);
  const render = (mode) => act(async () => root.render(createElement(Activity, { mode }, kept)));
  await render("visible");
  await render("hidden");
  assert.deepEqual(listening(), NONE);
  await render("visible");
  assert.deepEqual(listening(), { visibilitychange: 1, focus: 1, online: 1, offline: 1 });
  await act(async () => root.unmount());
  assert.deepEqual(listening(), NONE);
});

for (const [name, { options, event }] of Object.entries({
  focus: { options: { revalidateOnFocus: true }, event: () => window.dispatchEvent(new window.Event("focus")) },
  reconnect: { options: { revalidateOnReconnect: true }, event: () => window.dispatchEvent(new window.Event("online")) },
})) {
  test(`a StrictMode scope revalidates once on ${name}`, async (t) => {
    const api = server();
    const root = createRoot(document.createElement("div"));
    t.after(() => act(async () => root.unmount()));
    await act(async () => root.render(createElement(StrictMode, null, scope(api, { fresh: true, ...options }))));
    await settle();
    assert.equal(api.requests.length, 0);
    await act(async () => event());
    await settle();
    assert.deepEqual(api.requests, [["item", "a"]]);
  });
}
