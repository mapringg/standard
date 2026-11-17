import assert from "node:assert/strict";
import { test } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { JSDOM } from "jsdom";

setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc");

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/", pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, Activity, createElement, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SWRConfig } = await import("swr");
const { cache } = await import("swr/_internal");
const { useServerData } = await import("../templates/swr.ts");

const CHECKING = { status: "checking" };

function sessionServer(first) {
  const requests = [];
  let answer = first;
  return {
    requests,
    answer: (next) => {
      answer = next;
    },
    async session(key) {
      requests.push(key);
      return { status: answer, request: requests.length };
    },
  };
}

function gate(api, renders, label) {
  return function Gate() {
    const session = useServerData(["session"], api.session, { fallbackData: CHECKING, visit: true });
    renders.push({ label, status: session.data.status, request: session.data.request, validating: session.validating });
    return null;
  };
}

async function settle(until = () => false) {
  for (let waited = 0; waited < 500 && !until(); waited += 10) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

function app(t) {
  const root = createRoot(document.createElement("div"));
  t.after(() => act(async () => root.unmount()));
  return (element) => act(async () => root.render(createElement(SWRConfig, { value: { dedupingInterval: 0 } }, element)));
}

const last = (renders, label) => renders.findLast((render) => render.label === label);

test("a visit hook asks the server again on every real mount", async (t) => {
  const api = sessionServer("signed-in");
  const renders = [];
  const render = app(t);
  await render(createElement(gate(api, renders, "first")));
  await settle(() => last(renders, "first").status === "signed-in");
  await render(null);
  await render(createElement(gate(api, renders, "second")));
  await settle(() => api.requests.length === 2 && last(renders, "second").status === "signed-in");
  assert.deepEqual({ requests: api.requests.length, first: renders[0], second: renders.find((one) => one.label === "second") }, { requests: 2, first: { label: "first", status: "checking", request: undefined, validating: true }, second: { label: "second", status: "checking", request: undefined, validating: true } });
});

test("a visit hook under StrictMode sends one request for its mount", async (t) => {
  const api = sessionServer("signed-in");
  const renders = [];
  const render = app(t);
  await render(createElement(StrictMode, null, createElement(gate(api, renders, "strict"))));
  await settle(() => last(renders, "strict").status === "signed-in");
  await settle();
  assert.deepEqual(api.requests, [["session"]]);
});

test("a remembered signed-out answer never renders on the next visit", async (t) => {
  const api = sessionServer("signed-out");
  const renders = [];
  const render = app(t);
  await render(createElement(gate(api, renders, "first")));
  await settle(() => last(renders, "first").status === "signed-out");
  await render(null);
  api.answer("signed-in");
  await render(createElement(gate(api, renders, "second")));
  await settle(() => last(renders, "second").status === "signed-in");
  const second = renders.filter((one) => one.label === "second");
  assert.deepEqual({ requests: api.requests.length, shown: [...new Set(second.map((one) => one.status))], opens: second[0] }, { requests: 2, shown: ["checking", "signed-in"], opens: { label: "second", status: "checking", request: undefined, validating: true } });
});

test("two visit hooks mounted at once each ask the server and show their own answer", async (t) => {
  const api = sessionServer("signed-in");
  const renders = [];
  const render = app(t);
  await render(createElement("div", null, createElement(gate(api, renders, "header")), createElement(gate(api, renders, "page"))));
  await settle(() => last(renders, "header").status === "signed-in" && last(renders, "page").status === "signed-in");
  const answers = new Set([last(renders, "header").request, last(renders, "page").request]);
  assert.deepEqual({ requests: api.requests.length, answers: [...answers].sort() }, { requests: 2, answers: [1, 2] });
});

test("a visit hook that an Activity hides and shows again keeps its answer and asks nothing new", async (t) => {
  const api = sessionServer("signed-out");
  const renders = [];
  const render = app(t);
  const Gate = gate(api, renders, "kept");
  const kept = (mode, round) => createElement(Activity, { mode }, createElement(Gate, { round }));
  await render(kept("visible", 0));
  await settle(() => last(renders, "kept").status === "signed-out");
  const before = renders.length;
  await render(kept("hidden", 0));
  api.answer("signed-in");
  await render(kept("hidden", 1));
  await settle();
  await render(kept("visible", 1));
  await settle();
  assert.deepEqual({ requests: api.requests.length, shown: [...new Set(renders.slice(before).map((one) => `${one.status} ${one.validating}`))] }, { requests: 1, shown: ["signed-out false"] });
});

test("a visit hook leaves no cache entry once its component unmounts", async (t) => {
  const api = sessionServer("signed-in");
  const renders = [];
  const render = app(t);
  const before = new Set(cache.keys());
  const added = () => [...cache.keys()].filter((key) => !before.has(key));
  await render(createElement(gate(api, renders, "gone")));
  await settle(() => last(renders, "gone").status === "signed-in");
  assert.equal(added().length, 1);
  await render(null);
  for (let round = 0; round < 50 && added().length > 0; round += 1) {
    collectGarbage();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  assert.deepEqual(added(), []);
});
