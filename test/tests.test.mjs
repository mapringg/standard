import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const source = "export const add = (a: number, b: number) => a + b;\n";
const vitest = 'import { expect, test, vi } from "vitest";\nimport { add } from "@/lib/add";\n';

test("tests rule bans nondeterminism and weak assertions", (t) => {
  const result = lint(t, {
    "packages/i18n/src/add.ts": source,
    "packages/i18n/src/add.test.ts": `${vitest}test("adds", () => { expect(add(1, 2)).toBe(3); });\ntest.each([[1, 2]])("table", (a, b) => { expect(add(a, b)).toBe(3); });\n`,
    "packages/i18n/src/clock.ts": source,
    "packages/i18n/src/clock.test.ts": `${vitest}test("clock", () => { expect(Date.now()).toBeGreaterThan(add(0, 0)); });\n`,
    "packages/i18n/src/fake.ts": source,
    "packages/i18n/src/fake.test.ts": `${vitest}vi.useFakeTimers();\ntest("fake", () => { expect(new Date().getTime()).toBe(add(0, 0)); });\n`,
    "packages/i18n/src/slow.ts": source,
    "packages/i18n/src/slow.test.ts": `${vitest}test("slow", () => { expect(add(1, 1)).toBe(2); }, 10000);\ntest("opts", { timeout: 5 }, () => { expect(add(1, 1)).toBe(2); });\n`,
    "packages/i18n/src/loop.ts": source,
    "packages/i18n/src/loop.test.ts": `${vitest}for (const n of [1, 2]) test(String(n), () => { expect(add(n, 0)).toBe(n); });\n`,
    "packages/i18n/src/poll.ts": source,
    "packages/i18n/src/poll.test.ts": `${vitest}test("poll", () => { let n = 0; while (n < 3) n = add(n, 1); expect(n).toBe(3); });\n`,
    "packages/i18n/src/calls.ts": source,
    "packages/i18n/src/calls.test.ts": `${vitest}test("calls", () => { const spy = vi.fn(add); spy(1, 2); expect(spy).toHaveBeenCalledWith(1, 2); });\n`,
    "packages/i18n/src/view.tsx": "export const View = () => null;\n",
    "packages/i18n/src/view.test.tsx":
      'import { render, screen } from "@testing-library/react";\nimport { expect, test } from "vitest";\nimport { View } from "@/view";\ntest("renders", () => { render(<View />); expect(screen.getByRole("main")).toBeInTheDocument(); });\n',
    "packages/i18n/src/mocked.ts": source,
    "packages/i18n/src/mocked.test.ts": `${vitest}vi.mock("@/lib/add");\nvi.mock("ky");\ntest("mocked", () => { expect(add(1, 2)).toBe(3); });\n`,
    "packages/i18n/vitest.config.ts": "export default { test: { coverage: { thresholds: { lines: 90 } } } };\n",
  });
  const found = only(result, "tests")
    .map((item) => `${item.file.split("/").at(-1)}: ${item.message.split(".")[0]}`)
    .sort();
  deepEqual(found, [
    "calls.test.ts: A test that only checks calls proves nothing",
    "clock.test.ts: No real clock in tests",
    "loop.test.ts: No tests inside loops",
    "mocked.test.ts: Mock only what leaves the repo (network, LINE SDK, next/*, time)",
    "poll.test.ts: No polling loops in tests",
    "slow.test.ts: No per-test timeouts",
    "slow.test.ts: No per-test timeouts",
    "view.test.tsx: No render-only component tests",
    "vitest.config.ts: No coverage thresholds",
  ]);
});
