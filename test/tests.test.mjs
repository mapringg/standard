import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const source = "export const add = (a: number, b: number) => a + b;\n";
const vitest = 'import { expect, test, vi } from "vitest";\nimport { add } from "@/lib/add";\n';
const double = "Fake HTTP with MSW handlers and other boundaries with a typed fake in *.fixture.ts";

test("tests rule bans nondeterminism, weak assertions and test doubles", (t) => {
  const result = lint(t, {
    "packages/i18n/src/add.ts": source,
    "packages/i18n/src/add.test.ts": `${vitest}test("adds", () => { expect(add(1, 2)).toBe(3); });\ntest.each([[1, 2]])("table", (a, b) => { expect(add(a, b)).toBe(3); });\n`,
    "packages/i18n/src/spy.ts": source,
    "packages/i18n/src/spy.test.ts": `${vitest}test("spy", () => { const spy = vi.spyOn(console, "info"); expect(add(1, 2)).toBe(3); expect(spy).not.toHaveBeenCalled(); });\n`,
    "packages/i18n/src/net.ts": source,
    "packages/i18n/src/net.test-utils.ts":
      'import { setupServer } from "msw/node";\nexport const server = setupServer();\nserver.listen({ onUnhandledRequest: "error" });\n',
    "packages/i18n/src/loose.ts": source,
    "packages/i18n/src/loose.test-utils.ts":
      'import { setupServer } from "msw/node";\nexport const server = setupServer();\nserver.listen();\n',
    "packages/i18n/src/clock.ts": source,
    "packages/i18n/src/clock.test.ts": `${vitest}test("clock", () => { expect(Date.now()).toBeGreaterThan(add(0, 0)); });\n`,
    "packages/i18n/src/fake.ts": source,
    "packages/i18n/src/fake.test.ts": `${vitest}vi.useFakeTimers();\ntest("fake", () => { expect(new Date().getTime()).toBe(add(0, 0)); });\n`,
    "packages/i18n/src/slow.ts": source,
    "packages/i18n/src/slow.test.ts": `${vitest}test("slow", () => { expect(add(1, 1)).toBe(2); }, 10000);\n`,
    "packages/i18n/src/loop.ts": source,
    "packages/i18n/src/loop.test.ts": `${vitest}for (const n of [1, 2]) test(String(n), () => { expect(add(n, 0)).toBe(n); });\n`,
    "packages/i18n/src/poll.ts": source,
    "packages/i18n/src/poll.test.ts": `${vitest}test("poll", () => { let n = 0; while (n < 3) n = add(n, 1); expect(n).toBe(3); });\n`,
    "packages/i18n/src/calls.ts": source,
    "packages/i18n/src/calls.test.ts": `${vitest}test("calls", () => { const spy = vi.spyOn(console, "info"); add(1, 2); expect(spy).toHaveBeenCalledWith(1, 2); });\n`,
    "packages/i18n/src/view.tsx": "export const View = () => null;\n",
    "packages/i18n/src/view.test.tsx":
      'import { render, screen } from "@testing-library/react";\nimport { expect, test } from "vitest";\nimport { View } from "@/view";\ntest("renders", () => { render(<View />); expect(screen.getByRole("main")).toBeInTheDocument(); });\n',
    "packages/i18n/src/mocked.ts": source,
    "packages/i18n/src/mocked.test.ts": `${vitest}vi.mock("ky");\nconst stub = vi.fn(() => 1);\nvi.stubGlobal("fetch", stub);\nvi.spyOn(Math, "random").mockReturnValue(0);\nDate.prototype.getDay = () => 1;\ntest("mocked", () => { expect(add(1, 2)).toBe(3); });\n`,
    "packages/i18n/src/cdp.ts": source,
    "packages/i18n/src/cdp.fixture.ts":
      'import { vi } from "vitest";\nexport const cdp = { send: vi.fn(async () => ({ ok: true })), fetch: vi.fn() };\nexport const page = { title: vi.fn<() => string>().mockReturnValue("x") };\n',
    "packages/i18n/src/stream.ts": "export async function* chunks() { yield await Promise.resolve(1); }\n",
    "packages/i18n/src/stream.test.ts":
      'import { expect, test } from "vitest";\nimport { chunks } from "@/stream";\ntest("streams", async () => { const seen: number[] = []; for await (const chunk of chunks()) seen.push(chunk); expect(seen).toStrictEqual([1]); });\n',
    "packages/i18n/vitest.config.ts": "export default { test: { coverage: { thresholds: { lines: 90 } } } };\n",
  });
  const found = only(result, "tests")
    .map((item) => `${item.file.split("/").at(-1)}: ${item.message.replace(/\.$/, "")}`)
    .sort();
  deepEqual(
    result.filter((item) => item.file.endsWith("stream.test.ts") && /loop|await|standard/.test(item.rule)),
    [],
  );
  deepEqual(found, [
    "calls.test.ts: Assert the outcome the user or caller sees, not only that a function was called",
    "cdp.fixture.ts: Fake HTTP with MSW handlers instead of a fetch fake",
    "clock.test.ts: Call vi.useFakeTimers() and vi.setSystemTime() instead of reading the real clock",
    "loop.test.ts: Write one test.each with a table instead of a loop",
    'loose.test-utils.ts: Start the MSW server with listen({ onUnhandledRequest: "error" })',
    `mocked.test.ts: ${double}`,
    `mocked.test.ts: ${double}`,
    `mocked.test.ts: ${double}`,
    `mocked.test.ts: ${double}`,
    `mocked.test.ts: ${double}`,
    "poll.test.ts: Await the real event instead of looping",
    "slow.test.ts: Drop the timeout and make the test fast and deterministic",
    "view.test.tsx: Assert behavior after an interaction, or delete the render-only test",
    "vitest.config.ts: Remove the coverage threshold; keep only tests that protect a contract",
  ]);
});
