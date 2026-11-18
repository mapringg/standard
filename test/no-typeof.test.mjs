import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("no-typeof flags runtime typeof except undefined probes", (t) => {
  const result = lint(t, {
    "packages/i18n/src/probe.ts": 'export const browser = typeof window !== "undefined";\n',
    "packages/i18n/src/kind.ts": "const value = 1;\nexport type Value = typeof value;\n",
    "packages/i18n/src/narrow.ts": 'export const isText = (value: unknown) => typeof value === "string";\n',
    "packages/i18n/src/switch.ts": "export const kind = (value: unknown) => typeof value;\n",
  });
  deepEqual(filesWith(result, "no-typeof"), ["packages/i18n/src/narrow.ts", "packages/i18n/src/switch.ts"]);
});
