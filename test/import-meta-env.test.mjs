import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("import-meta-env allows only src/lib/env.ts and app config", (t) => {
  const result = lint(t, {
    "apps/liff/src/lib/env.ts": "export const url = import.meta.env.VITE_API_URL;\n",
    "apps/liff/vite.config.ts": "export const url = import.meta.env.VITE_API_URL;\n",
    "apps/liff/src/features/task/task-api.ts": "export const url = import.meta.env.VITE_API_URL;\n",
  });
  deepEqual(filesWith(result, "import-meta-env"), ["apps/liff/src/features/task/task-api.ts"]);
});
