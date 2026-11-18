import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("UI features import only themselves, lib and components", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-list.tsx": [
      'import { log } from "@/lib/log";',
      'import { Button } from "@/components/ui/button";',
      'import { taskHref } from "@/features/task/task-params";',
      "export const all = [log, Button, taskHref];",
    ].join("\n"),
    "apps/web/src/features/task/task-board.tsx":
      'import { user } from "@/features/user/user-card";\nexport const all = [user];\n',
  });
  deepEqual(filesWith(result, "feature-imports"), ["apps/web/src/features/task/task-board.tsx"]);
});

test("API features import other features' db.ts and schema.ts, routes also service.ts", (t) => {
  const result = lint(t, {
    "apps/api/src/features/tasks/db.ts": [
      'import { users } from "@/features/users/db";',
      'import { userSchema } from "@/features/users/schema";',
      "export const all = [users, userSchema];",
    ].join("\n"),
    "apps/api/src/features/tasks/routes.ts":
      'import { assign } from "@/features/users/service";\nexport const all = [assign];\n',
    "apps/api/src/features/tasks/service.ts":
      'import { routes } from "@/features/users/routes";\nexport const all = [routes];\n',
  });
  deepEqual(filesWith(result, "feature-imports"), ["apps/api/src/features/tasks/service.ts"]);
});
