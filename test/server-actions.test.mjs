import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint, only } from "./lint.mjs";

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

test("server-actions asks a component named *-actions.tsx to be renamed", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-row-actions.tsx":
      '"use client";\nexport function TaskRowActions() { return null; }\n',
  });
  deepEqual(
    only(result, "server-actions").map((item) => item.message),
    ["Rename this component file so it does not end in -actions; <feature>-actions.ts holds only Server Actions."],
  );
});
