import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("no-return-types flags annotated implementations only", (t) => {
  const result = lint(t, {
    "packages/i18n/src/inferred.ts": "export const add = (a: number, b: number) => a + b;\n",
    "packages/i18n/src/guard.ts":
      "export function isText(value: string | number): value is string { return value === String(value); }\n",
    "packages/i18n/src/overload.ts":
      "export function pick(value: string): string;\nexport function pick(value: number): number;\nexport function pick(value: string | number) { return value; }\n",
    "packages/i18n/src/arrow.ts": "export const add = (a: number, b: number): number => a + b;\n",
    "packages/i18n/src/declared.ts": "export function add(a: number, b: number): number { return a + b; }\n",
  });
  deepEqual(filesWith(result, "no-return-types"), ["packages/i18n/src/arrow.ts", "packages/i18n/src/declared.ts"]);
});
