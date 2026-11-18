import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("UI features import only themselves, lib and components", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-list.tsx": [
      'import { log } from "#/lib/log.js";',
      'import { Button } from "#/components/ui/button.js";',
      'import { taskHref } from "#/features/task/task-params.js";',
      "export const all = [log, Button, taskHref];",
    ].join("\n"),
    "apps/web/src/features/task/task-board.tsx":
      'import { user } from "#/features/user/user-card.js";\nexport const all = [user];\n',
  });
  deepEqual(filesWith(result, "feature-imports"), ["apps/web/src/features/task/task-board.tsx"]);
});

test("API features import other features' db.ts and schema.ts, routes also service.ts", (t) => {
  const result = lint(t, {
    "apps/api/src/features/tasks/db.ts": [
      'import { users } from "#/features/users/db.js";',
      'import { userSchema } from "#/features/users/schema.js";',
      "export const all = [users, userSchema];",
    ].join("\n"),
    "apps/api/src/features/tasks/routes.ts":
      'import { assign } from "#/features/users/service.js";\nexport const all = [assign];\n',
    "apps/api/src/features/tasks/service.ts":
      'import { routes } from "#/features/users/routes.js";\nexport const all = [routes];\n',
  });
  deepEqual(filesWith(result, "feature-imports"), ["apps/api/src/features/tasks/service.ts"]);
});

test("imports go through #/, never relative paths or @/", (t) => {
  const result = lint(t, {
    "apps/web/src/lib/a.ts": 'import { b } from "#/lib/b.js";\nexport const a = b;\n',
    "apps/web/src/lib/b.ts": 'import { c } from "./c";\nexport const b = c;\n',
    "apps/web/src/lib/c.ts": 'import { a } from "@/lib/a";\nexport const c = a;\n',
  });
  const files = result.filter((item) => item.rule === "eslint(no-restricted-imports)").map((item) => item.file);
  deepEqual(files.toSorted(), ["apps/web/src/lib/b.ts", "apps/web/src/lib/c.ts"]);
});
