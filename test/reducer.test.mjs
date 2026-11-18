import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("reducer allows one useReducer per component with a reducer from -state", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-state.ts":
      'export const taskReducer = (state: number, action: { type: "inc" }) => (action.type === "inc" ? state + 1 : state);\n',
    "apps/web/src/features/task/task-form-state.ts":
      "export const formReducer = (_state: string, next: string) => next;\n",
    "apps/web/src/features/task/task-good.tsx": [
      'import { useReducer } from "react";',
      'import { taskReducer } from "@/features/task/task-state";',
      "export function TaskGood() { const [count] = useReducer(taskReducer, 0); return count; }",
    ].join("\n"),
    "apps/web/src/features/task/task-twice.tsx": [
      'import { useReducer } from "react";',
      'import { taskReducer } from "@/features/task/task-state";',
      "export function TaskTwice() { const [a] = useReducer(taskReducer, 0); const [b] = useReducer(taskReducer, 0); return a + b; }",
    ].join("\n"),
    "apps/web/src/features/task/task-inline.tsx": [
      'import { useReducer } from "react";',
      "export function TaskInline() { const [a] = useReducer((s: number) => s, 0); return a; }",
    ].join("\n"),
  });
  deepEqual(filesWith(result, "reducer"), [
    "apps/web/src/features/task/task-form-state.ts",
    "apps/web/src/features/task/task-inline.tsx",
    "apps/web/src/features/task/task-twice.tsx",
  ]);
});
