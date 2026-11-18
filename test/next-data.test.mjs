import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { crashes, filesWith, lint, only } from "./lint.mjs";

const imports =
  'import { cacheLife, cacheTag } from "next/cache";\nimport { taskTag } from "#/features/task/task-cache";\n';

test("next-data checks use cache, tags and server-only", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-cache.ts":
      'import { cacheTag } from "next/cache";\nexport const taskTag = "tasks";\nexport const tagTasks = () => cacheTag("tasks");\n',
    "apps/web/src/features/task/task-data.server.ts": `import "server-only";\n${imports}export async function listTasks() { "use cache"; cacheTag(taskTag); cacheLife("hours"); return []; }\n`,
    "apps/web/src/features/task/task-untagged.server.ts": `import "server-only";\n${imports}export async function listTasks() { "use cache"; cacheLife("hours"); return [taskTag]; }\n`,
    "apps/web/src/features/task/task-user.server.ts": `import "server-only";\n${imports}export async function listTasks(userId: string) { "use cache"; cacheTag(taskTag); cacheLife("hours"); return [userId]; }\n`,
    "apps/web/src/features/task/task-literal.server.ts": `import "server-only";\n${imports}export async function listTasks() { "use cache"; cacheTag("tasks"); cacheLife("hours"); return [taskTag]; }\n`,
    "apps/web/src/features/task/task-open.server.ts": "export const open = 1;\n",
    "apps/web/src/features/task/task-reload.tsx":
      'import { useRouter } from "next/navigation";\nexport function TaskReload() { const r = useRouter(); return () => [r.refresh(), useRouter().refresh()]; }\n',
  });
  deepEqual(filesWith(result, "next-data"), [
    "apps/web/src/features/task/task-literal.server.ts",
    "apps/web/src/features/task/task-open.server.ts",
    "apps/web/src/features/task/task-reload.tsx",
    "apps/web/src/features/task/task-untagged.server.ts",
    "apps/web/src/features/task/task-user.server.ts",
  ]);
});

test("next-data and server-actions accept expression-bodied arrows", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-cleanup.ts": "export const cleanup = () => () => 1;\n",
    "apps/web/src/features/task/task-actions.ts":
      '"use server";\nexport const saveAction = async () => ({ ok: true });\n',
  });
  deepEqual(crashes(result), []);
});

test("next-data keeps *.server.ts out of client components", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-data.server.ts":
      'import "server-only";\nexport const listTasks = async () => [];\n',
    "apps/web/src/features/task/task-picker.tsx":
      '"use client";\nimport { listTasks } from "#/features/task/task-data.server";\nexport const TaskPicker = () => listTasks;\n',
    "apps/web/src/features/task/task-list.tsx":
      'import { listTasks } from "#/features/task/task-data.server";\nexport const TaskList = () => listTasks;\n',
  });
  deepEqual(
    only(result, "next-data").map((item) => `${item.file}: ${item.message}`),
    [
      "apps/web/src/features/task/task-picker.tsx: Load the data in a Server Component and pass it to this client component as props instead of importing *.server.ts.",
    ],
  );
});

test("next-data lets client components import types from *.server.ts", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-data.server.ts":
      'import "server-only";\nexport type Task = { id: string };\nexport const listTasks = async () => [];\n',
    "apps/web/src/features/task/task-row.tsx":
      '"use client";\nimport type { Task } from "#/features/task/task-data.server";\nexport const TaskRow = (props: { task: Task }) => props.task.id;\n',
    "apps/web/src/features/task/task-cell.tsx":
      '"use client";\nimport { type Task } from "#/features/task/task-data.server";\nexport type { Task } from "#/features/task/task-data.server";\nexport const TaskCell = (props: { task: Task }) => props.task.id;\n',
  });
  deepEqual(filesWith(result, "next-data"), []);
});
