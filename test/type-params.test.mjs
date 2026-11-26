import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const lengths = [
  "function source<const B extends readonly string[]>(items: B) {",
  "  return { ok: true, items: items.map((item) => item.length) as { -readonly [K in keyof B]: number } };",
  "}",
  "export function wrap<const B extends readonly string[]>(items: B) {",
  "  const read = source(items);",
  "  return { ok: true, value: read.items } satisfies { ok: true; value: { -readonly [K in keyof B]: number } };",
  "}",
  'export const pair = wrap(["a", "b"]);',
  "",
].join("\n");

test("a generic used only in an inferred return passes", (t) => {
  const result = lint(t, { "packages/i18n/src/lengths.ts": lengths });
  deepEqual(
    result.filter((item) => item.rule === "typescript(no-unnecessary-type-parameters)"),
    [],
  );
});
