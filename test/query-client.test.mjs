import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

const client = (options) =>
  `import { QueryClient } from "@tanstack/react-query";\nexport const client = new QueryClient(${options});\n`;

test("query-client requires a retry function in lib/query.ts", (t) => {
  const result = lint(t, {
    "apps/web/src/lib/query.ts": client(
      "{ defaultOptions: { queries: { retry: (count: number, error: Error) => count < 2 && error.name !== 'ApiError' } } }",
    ),
    "apps/liff/src/lib/query.ts": client("{ defaultOptions: { queries: { retry: 1 } } }"),
    "apps/mobile/src/lib/query.ts": client("{}"),
    "apps/marketing/src/lib/query.ts": `const retry = false;\n${client("{ defaultOptions: { queries: { retry } } }")}`,
    "apps/next/package.json": JSON.stringify({ dependencies: { next: "1.0.0" } }),
    "apps/next/src/lib/query.ts": `function retry(count: number) { return count < 1; }\n${client("{ defaultOptions: { queries: { retry } } }")}`,
    "apps/vite/package.json": JSON.stringify({ dependencies: { vite: "1.0.0" } }),
    "apps/vite/src/lib/query.ts": `import { retry } from "#/lib/retry";\n${client("{ defaultOptions: { queries: { retry } } }")}`,
  });
  deepEqual(filesWith(result, "query-client"), [
    "apps/liff/src/lib/query.ts",
    "apps/marketing/src/lib/query.ts",
    "apps/mobile/src/lib/query.ts",
  ]);
});
