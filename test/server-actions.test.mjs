import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("server-actions keeps actions in -actions.ts with Action names", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-actions.ts":
      '"use server";\nexport async function createTaskAction() { return { ok: true }; }\n',
    "apps/web/src/features/task/task-bad-actions.ts":
      '"use server";\nexport async function createTask() { return { ok: true }; }\n',
    "apps/web/src/features/task/task-missing-actions.ts": "export async function saveAction() { return 1; }\n",
    "apps/web/src/features/task/task-inline.tsx":
      'export function TaskInline() { async function save() { "use server"; } return save; }\n',
    "apps/web/src/features/task/task-elsewhere.ts": '"use server";\nexport async function moveAction() { return 1; }\n',
  });
  deepEqual(filesWith(result, "server-actions"), [
    "apps/web/src/features/task/task-bad-actions.ts",
    "apps/web/src/features/task/task-elsewhere.ts",
    "apps/web/src/features/task/task-inline.tsx",
    "apps/web/src/features/task/task-missing-actions.ts",
  ]);
});
