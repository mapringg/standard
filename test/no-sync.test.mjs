import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

test("flushSync from react-dom passes and fs sync calls still fail", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-scroll.ts": [
      'import { flushSync } from "react-dom";',
      "",
      "export function scroll(update: () => void) {",
      "  flushSync(update);",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/lib/read.ts": [
      'import { readFileSync } from "node:fs";',
      "",
      'export const text = readFileSync("a.txt", "utf8");',
      "",
    ].join("\n"),
  });
  deepEqual(
    result.filter((item) => item.rule === "node(no-sync)").map((item) => `${item.file} ${item.message}`),
    ["apps/web/src/lib/read.ts Unexpected sync method: 'readFileSync'."],
  );
});
