import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { tempDir, write } from "./helpers.mjs";

const PACKAGE = join(import.meta.dirname, "..");
const TEMPLATE = join(PACKAGE, "templates/timer.ts");

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DELAY = 4321;
const LONGER = 8642;
const clock = new Map();
let nextId = 0;
const real = { setTimeout, clearTimeout, setInterval, clearInterval };
const schedule = (repeat, fallback) => (run, delay, ...rest) => {
  if (delay !== DELAY && delay !== LONGER) return fallback(run, delay, ...rest);
  const id = `timer ${(nextId += 1)}`;
  clock.set(id, { run, delay, repeat });
  return id;
};
const cancel = (fallback) => (id) => (clock.has(id) ? clock.delete(id) : fallback(id));
globalThis.setTimeout = schedule(false, real.setTimeout);
globalThis.clearTimeout = cancel(real.clearTimeout);
globalThis.setInterval = schedule(true, real.setInterval);
globalThis.clearInterval = cancel(real.clearInterval);

const frames = new Map();
globalThis.requestAnimationFrame = (run) => {
  const id = (nextId += 1);
  frames.set(id, run);
  return id;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);

const { StrictMode, act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useAnimationFrame, useInterval, useTimeout } = await import("../templates/timer.ts");

async function mount(t, useHook, props) {
  function Probe(probeProps) {
    useHook(probeProps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (next) => act(async () => root.render(createElement(StrictMode, null, next === null ? null : createElement(Probe, next))));
  t.after(() => act(async () => root.unmount()));
  await render(props);
  return render;
}

const elapse = (delay) =>
  act(async () => {
    for (const [id, timer] of [...clock]) {
      if (timer.delay !== delay) continue;
      if (!timer.repeat) clock.delete(id);
      timer.run();
    }
  });

const frame = (time) =>
  act(async () => {
    const due = [...frames.values()];
    frames.clear();
    due.forEach((run) => run(time));
  });

test("useTimeout runs the latest callback once after its delay, with one timer under StrictMode's double mount", async (t) => {
  clock.clear();
  const calls = [];
  const render = await mount(t, ({ label }) => useTimeout(() => calls.push(label), DELAY), { label: "first" });
  assert.equal(clock.size, 1);
  await render({ label: "second" });
  assert.equal(clock.size, 1);
  await elapse(DELAY);
  await elapse(DELAY);
  assert.deepEqual(calls, ["second"]);
});

test("useTimeout waits while its delay is null, restarts on a new delay, and never runs after unmount", async (t) => {
  clock.clear();
  const calls = [];
  const render = await mount(t, ({ delay }) => useTimeout(() => calls.push(delay), delay), { delay: null });
  assert.equal(clock.size, 0);
  await render({ delay: DELAY });
  await render({ delay: LONGER });
  assert.deepEqual([...clock.values()].map((timer) => timer.delay), [LONGER]);
  await render(null);
  assert.equal(clock.size, 0);
  await elapse(LONGER);
  assert.deepEqual(calls, []);
});

test("useInterval runs on every tick with one interval under StrictMode, and stops on unmount", async (t) => {
  clock.clear();
  let ticks = 0;
  const render = await mount(t, () => useInterval(() => (ticks += 1), DELAY), {});
  assert.equal(clock.size, 1);
  await elapse(DELAY);
  await elapse(DELAY);
  await elapse(DELAY);
  await render(null);
  assert.deepEqual({ ticks, timers: clock.size }, { ticks: 3, timers: 0 });
});

test("useInterval calls the latest callback on the next tick without restarting the interval", async (t) => {
  clock.clear();
  const calls = [];
  const render = await mount(t, ({ label }) => useInterval(() => calls.push(label), DELAY), { label: "first" });
  const started = [...clock.keys()];
  await elapse(DELAY);
  await render({ label: "second" });
  await elapse(DELAY);
  assert.deepEqual({ calls, timers: [...clock.keys()] }, { calls: ["first", "second"], timers: started });
});

test("useInterval restarts on a new delay", async (t) => {
  clock.clear();
  const render = await mount(t, ({ delay }) => useInterval(() => {}, delay), { delay: DELAY });
  await render({ delay: LONGER });
  assert.deepEqual([...clock.values()].map((timer) => timer.delay), [LONGER]);
});

test("useInterval waits while its delay is null and never runs then", async (t) => {
  clock.clear();
  const calls = [];
  const render = await mount(t, ({ delay }) => useInterval(() => calls.push(delay), delay), { delay: null });
  assert.deepEqual({ calls, timers: clock.size }, { calls: [], timers: 0 });
  await render({ delay: DELAY });
  await elapse(DELAY);
  await render({ delay: null });
  assert.deepEqual({ calls, timers: clock.size }, { calls: [DELAY], timers: 0 });
});

test("useAnimationFrame calls the latest callback on the next frame without restarting", async (t) => {
  frames.clear();
  const calls = [];
  const render = await mount(t, ({ label }) => useAnimationFrame(() => calls.push(label), true), { label: "first" });
  await frame(16);
  await render({ label: "second" });
  await frame(32);
  assert.deepEqual(calls, ["first", "second"]);
});

test("useAnimationFrame runs once a frame with its time while running, and stops when it stops or unmounts", async (t) => {
  frames.clear();
  const times = [];
  const render = await mount(t, ({ running }) => useAnimationFrame((time) => times.push(time), running), { running: true });
  assert.equal(frames.size, 1);
  await frame(16);
  await frame(32);
  assert.deepEqual([times, frames.size], [[16, 32], 1]);
  await render({ running: false });
  assert.equal(frames.size, 0);
  await render({ running: true });
  await render(null);
  assert.deepEqual([times, frames.size], [[16, 32], 0]);
});

test("oxfmt with the shared config leaves the timer template as shipped", () => {
  const { stdout, stderr, status } = spawnSync(join(PACKAGE, "node_modules/.bin/oxfmt"), ["--config", join(PACKAGE, "config/oxfmt.json"), "--check", TEMPLATE], { encoding: "utf8" });
  assert.equal(status, 0, stdout + stderr);
});

function copied(t) {
  const root = tempDir(t, "timer");
  write(root, {
    ".oxlintrc.json": { extends: [join(PACKAGE, "config/oxlint.json")], plugins: ["react"] },
    "tsconfig.json": {
      extends: join(PACKAGE, "config/tsconfig.json"),
      compilerOptions: { noEmit: true, module: "preserve", target: "esnext", jsx: "preserve", lib: ["esnext", "dom"], types: [] },
      include: ["src"],
    },
  });
  cpSync(TEMPLATE, join(root, "src/lib/timer.ts"));
  symlinkSync(join(PACKAGE, "node_modules"), join(root, "node_modules"));
  return root;
}

test("oxlint with the shared config and the react plugin finds nothing in the timer template", (t) => {
  const { stdout, stderr, status } = spawnSync(join(PACKAGE, "node_modules/.bin/oxlint"), ["src"], { cwd: copied(t), encoding: "utf8" });
  assert.deepEqual({ stdout, stderr, status }, { stdout: "", stderr: "", status: 0 });
});

test("the timer template passes the strict base", (t) => {
  const { stdout, stderr, status } = spawnSync(process.execPath, [join(PACKAGE, "node_modules/typescript/bin/tsc"), "-p", copied(t)], { encoding: "utf8" });
  assert.deepEqual({ stdout, stderr, status }, { stdout: "", stderr: "", status: 0 });
});
