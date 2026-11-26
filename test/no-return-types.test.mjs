import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint, only } from "./lint.mjs";

test("no-return-types flags annotated implementations only", (t) => {
  const result = lint(t, {
    "packages/i18n/src/inferred.ts": "export const add = (a: number, b: number) => a + b;\n",
    "packages/i18n/src/guard.ts":
      "export function isText(value: string | number): value is string { return value === String(value); }\n",
    "packages/i18n/src/overload.ts":
      "export function pick(value: string): string;\nexport function pick(value: number): number;\nexport function pick(value: string | number) { return value; }\n",
    "packages/i18n/src/arrow.ts": "export const add = (a: number, b: number): number => a + b;\n",
    "packages/i18n/src/declared.ts": "export function add(a: number, b: number): number { return a + b; }\n",
  });
  deepEqual(filesWith(result, "no-return-types"), ["packages/i18n/src/arrow.ts", "packages/i18n/src/declared.ts"]);
});

test("no-return-types lets a directly recursive function name its return type", (t) => {
  const result = lint(t, {
    "packages/i18n/src/depth.ts": [
      "type Tree = { children: Tree[] };",
      "",
      "export const depth = (tree: Tree): number => Math.max(0, ...tree.children.map((child) => depth(child))) + 1;",
      "",
      "export function count(tree: Tree): number {",
      "  return 1 + tree.children.reduce((sum, child) => sum + count(child), 0);",
      "}",
      "",
      "export const size = function walk(tree: Tree): number {",
      "  return tree.children.length + tree.children.reduce((sum, child) => sum + walk(child), 0);",
      "};",
      "",
    ].join("\n"),
    "packages/i18n/src/flat.ts": [
      "export const one = (): number => 1;",
      "",
      "export const two = (): number => one() + one();",
      "",
    ].join("\n"),
  });
  deepEqual(
    only(result, "no-return-types").map((item) => item.file),
    ["packages/i18n/src/flat.ts", "packages/i18n/src/flat.ts"],
  );
});
