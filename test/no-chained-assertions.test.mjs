import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("no-chained-assertions flags nested assertions but allows as const", (t) => {
  const result = lint(t, {
    "packages/i18n/src/single.ts": "export const a = (1 as number) + 1;\n",
    "packages/i18n/src/consts.ts": "export const a = ([1, 2] as const) as readonly number[];\n",
    "packages/i18n/src/chained.ts": "export const a = ({} as unknown) as string;\n",
    "packages/i18n/src/angle.ts": "export const a = <string>(<unknown>1);\n",
  });
  deepEqual(filesWith(result, "no-chained-assertions"), ["packages/i18n/src/angle.ts", "packages/i18n/src/chained.ts"]);
});
