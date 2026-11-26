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
      'import { taskReducer } from "#/features/task/task-state";',
      "export function TaskGood() { const [count] = useReducer(taskReducer, 0); return count; }",
    ].join("\n"),
    "apps/web/src/features/task/task-twice.tsx": [
      'import { useReducer } from "react";',
      'import { taskReducer } from "#/features/task/task-state";',
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

test("reducer accepts an instantiated or asserted reducer from -state", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-state.ts": [
      'export const rowsReducer = <T,>(rows: T[], action: { type: "add"; row: T }) =>',
      '  action.type === "add" ? [...rows, action.row] : rows;',
      "",
    ].join("\n"),
    "apps/web/src/features/task/task-rows.tsx": [
      'import { useReducer } from "react";',
      'import { rowsReducer } from "#/features/task/task-state";',
      "type Row = { id: string };",
      "export function Rows() { const [rows] = useReducer(rowsReducer<Row>, []); return rows.length; }",
      "export function Cast() { const [rows] = useReducer(rowsReducer as typeof rowsReducer<Row>, []); return rows.length; }",
      "export function Pin() { const [rows] = useReducer(rowsReducer<Row> satisfies unknown, []); return rows.length; }",
    ].join("\n"),
    "apps/web/src/features/task/task-local.tsx": [
      'import { useReducer } from "react";',
      "const local = <T,>(rows: T[]) => rows;",
      "export function Local() { const [rows] = useReducer(local<string>, []); return rows.length; }",
    ].join("\n"),
  });
  deepEqual(filesWith(result, "reducer"), ["apps/web/src/features/task/task-local.tsx"]);
});
