import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("params checks standard names and LIFF validateSearch", (t) => {
  const result = lint(t, {
    "apps/liff/src/features/task/task-params.ts":
      'import { z } from "zod";\nexport const taskParams = z.object({ q: z.string(), cursor: z.string(), dueFrom: z.string() });\n',
    "apps/liff/src/features/user/user-params.ts":
      'import { z } from "zod";\nexport const userParams = z.object({ page: z.number(), s: z.string() });\n',
    "apps/web/src/features/task/task-params.ts":
      'import { z } from "zod";\nexport const taskParams = z.object({ q: z.string(), sort: z.string(), range: z.string(), from: z.string(), to: z.string(), status: z.string() });\n',
    "apps/web/src/features/order/order-params.ts":
      'import { z } from "zod";\nexport const orderParams = z.object({ due_date: z.string(), sortBy: z.string(), keyword: z.string() });\n',
    "apps/liff/src/app/tasks.tsx":
      'import { createFileRoute } from "@tanstack/react-router";\nimport { taskParams } from "#/features/task/task-params.ts";\nexport const Route = createFileRoute("/tasks")({ validateSearch: taskParams });\n',
    "apps/liff/src/app/users.tsx":
      'import { createFileRoute } from "@tanstack/react-router";\nimport { z } from "zod";\nexport const Route = createFileRoute("/users")({ validateSearch: z.object({}) });\n',
  });
  deepEqual(filesWith(result, "params"), [
    "apps/liff/src/app/users.tsx",
    "apps/liff/src/features/user/user-params.ts",
    "apps/web/src/features/order/order-params.ts",
  ]);
});
