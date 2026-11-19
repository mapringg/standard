import { deepEqual } from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const RULES = new Set([
  "typescript(promise-function-async)",
  "eslint(class-methods-use-this)",
  "eslint(new-cap)",
  "unicorn(no-document-cookie)",
]);

test("adopter patterns pass the built-in rules that conflict with the standard", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-load.ts": [
      "const FALLBACK = 0;",
      "",
      "export const load = (client: { query: (n: number) => Promise<number> }) =>",
      "  client.query(1).catch(() => FALLBACK);",
      "",
    ].join("\n"),
    "apps/web/src/lib/x.ts": "export const x = 1;\n",
    "apps/web/src/lib/x.fixture.ts": [
      "globalThis.ResizeObserver ??= class {",
      "  observe = () => undefined;",
      "  unobserve = () => undefined;",
      "  disconnect = () => undefined;",
      "};",
      "",
      "export const ready = true;",
      "",
    ].join("\n"),
    "apps/web/src/features/task/task-font.ts": [
      "declare function Inter(options: { subsets: string[] }): { className: string };",
      "",
      'export const inter = Inter({ subsets: ["latin"] });',
      "",
    ].join("\n"),
    "apps/web/src/lib/cookie.browser.ts": "export const write = (value: string) => {\n  document.cookie = value;\n};\n",
  });
  deepEqual(
    result.filter((item) => RULES.has(item.rule)),
    [],
  );
});

test("class methods without this and lowercase constructors still fail", (t) => {
  const result = lint(t, {
    "apps/web/src/lib/box.ts": [
      "export class Box {",
      "  open() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "export const box = new (class {})();",
      "",
    ].join("\n"),
    "apps/web/src/lib/make.ts": "class thing {}\n\nexport const made = new thing();\n",
  });
  deepEqual(
    result
      .filter((item) => RULES.has(item.rule))
      .map((item) => `${item.file} ${item.rule}`)
      .sort(),
    ["apps/web/src/lib/box.ts eslint(class-methods-use-this)", "apps/web/src/lib/make.ts eslint(new-cap)"],
  );
});

const CONFLICTS = new Set([
  "react-hooks(rules-of-hooks)",
  "react(function-component-definition)",
  "promise(prefer-await-to-callbacks)",
  "typescript(method-signature-style)",
  "oxc(no-map-spread)",
  "eslint(default-case)",
  "typescript(consistent-return)",
  "unicorn(number-literal-case)",
  "unicorn(no-array-method-this-argument)",
  "unicorn(no-array-fill-with-reference-type)",
  "eslint(no-script-url)",
  "eslint(no-bitwise)",
  "unicorn(prefer-math-trunc)",
  "unicorn(prefer-code-point)",
  "import(max-dependencies)",
  "eslint(max-lines-per-function)",
  "typescript(switch-exhaustiveness-check)",
  "typescript(TS7030)",
]);

const conflicts = (result) =>
  result
    .filter((item) => CONFLICTS.has(item.rule))
    .map((item) => `${item.file} ${item.rule}`)
    .sort();

const mounts = Array.from({ length: 12 }, (_, index) => `r${index}`);

test("adopter patterns pass built-in rules that contradict each other or misread the code", (t) => {
  const result = lint(t, {
    "tsconfig.json": JSON.stringify({ extends: join(import.meta.dirname, "../tsconfig.json") }),
    "apps/api/src/features/tasks/service.ts": [
      "const read = () => 1;",
      "",
      "export const useConfig = () => read();",
      "",
      "export const run = () => useConfig();",
      "",
    ].join("\n"),
    "apps/api/src/lib/config.ts": "export const useLimit = () => 1;\n\nexport const limit = () => useLimit();\n",
    "apps/web/src/lib/single-flight.ts": [
      "export const Flight = async (key: string) => {",
      "  if (key) return null;",
      "  return key;",
      "};",
      "",
    ].join("\n"),
    "apps/api/src/lib/run.ts": [
      "export const run = async (callback: () => Promise<void>) => {",
      "  await callback();",
      "};",
      "",
    ].join("\n"),
    "apps/api/src/lib/tool.ts": [
      "interface Tool<I> {",
      "  run(input: I): number;",
      "}",
      "",
      "export const tools: Tool<unknown>[] = [{ run: (input: { a: string }) => input.a.length } as Tool<{ a: string }>];",
      "",
    ].join("\n"),
    "apps/api/src/lib/merge.ts": [
      "export const merge = () => {",
      "  const items = [{ a: 1 }];",
      "  return items.map((item) => ({ ...item, b: 1 }));",
      "};",
      "",
      "export const HEX = 0xff;",
      "",
    ].join("\n"),
    "apps/api/src/lib/kind.ts": [
      'type Kind = "a" | "b";',
      "",
      "export const label = (kind: Kind) => {",
      "  switch (kind) {",
      '    case "a": {',
      "      return 1;",
      "    }",
      '    case "b": {',
      "      return 2;",
      "    }",
      "  }",
      "};",
      "",
    ].join("\n"),
    "apps/api/src/lib/find.ts": [
      "declare const Model: { find: (query: object, projection: object) => unknown[] };",
      "",
      "export const load = () => Model.find({ a: 1 }, { b: 1 });",
      "",
      "export const box = { fill: (value: object) => value };",
      "",
      "export const filled = box.fill({});",
      "",
    ].join("\n"),
    "apps/api/src/lib/hash.ts": [
      "export const hash = (text: string) => {",
      "  let value = 5381;",
      "  for (let index = 0; index < text.length; index += 1) value = ((value << 5) + value + text.charCodeAt(index)) | 0;",
      "  return value >>> 0;",
      "};",
      "",
    ].join("\n"),
    "apps/api/src/lib/sanitize.ts": "export const clean = (text: string) => text.trim();\n",
    "apps/api/src/lib/sanitize.test.ts": 'export const input = "javascript:alert(1)";\n',
    "apps/api/src/app.ts": [
      ...mounts.map((name) => `import { ${name} } from "#/features/${name}/routes.ts";`),
      'import { factory } from "#/factory.ts";',
      "",
      "export const build = () => {",
      "  const app = factory.createApp();",
      ...Array.from({ length: 50 }, (_, index) => `  const step${index} = ${index};`),
      `  return [app, ${mounts.join(", ")}];`,
      "};",
      "",
    ].join("\n"),
  });
  deepEqual(conflicts(result), []);
});

test("hook rules, defaults on non-union switches and implicit returns still fail", (t) => {
  const result = lint(t, {
    "tsconfig.json": JSON.stringify({ extends: join(import.meta.dirname, "../tsconfig.json") }),
    "apps/web/src/features/task/task-open.ts": [
      'import { useReducer } from "react";',
      "",
      "export const useOpen = (on: boolean) => {",
      "  if (on) return useReducer((state: boolean) => !state, false);",
      "  return null;",
      "};",
      "",
    ].join("\n"),
    "apps/web/src/features/task/task-view.tsx": "export const TaskView = () => <div />;\n",
    "apps/web/src/lib/size.ts": [
      "export const size = (value: number) => {",
      "  switch (value) {",
      "    case 1: {",
      "      return 1;",
      "    }",
      "  }",
      "  return 0;",
      "};",
      "",
      "export const first = (value: number) => {",
      "  if (value) return 1;",
      "};",
      "",
    ].join("\n"),
  });
  deepEqual(conflicts(result), [
    "apps/web/src/features/task/task-open.ts react-hooks(rules-of-hooks)",
    "apps/web/src/features/task/task-view.tsx react(function-component-definition)",
    "apps/web/src/lib/size.ts typescript(TS7030)",
    "apps/web/src/lib/size.ts typescript(switch-exhaustiveness-check)",
  ]);
});

test("API SDK event callbacks need no DOM event listener API", (t) => {
  const assign =
    "export const attach = (transport: { onclose: () => void }, cleanup: () => void) => { transport.onclose = cleanup; };";
  const result = lint(t, {
    "apps/api/src/lib/transport.ts": assign,
    "apps/web/src/lib/transport.ts": assign,
  });
  deepEqual(
    result.filter((item) => item.rule === "unicorn(prefer-add-event-listener)").map((item) => item.file),
    ["apps/web/src/lib/transport.ts"],
  );
});

test("Next composition files may import more than ten features", (t) => {
  const composition =
    mounts.map((name) => `import { ${name} } from "#/features/${name}/${name}";`).join("\n") +
    `\nexport default function View() { return [${mounts.join(", ")}]; }`;
  const result = lint(t, {
    "apps/web/src/app/layout.tsx": composition,
    "apps/web/src/app/[lang]/page.tsx": composition,
    "apps/web/src/app/[lang]/template.tsx": composition,
    "apps/web/src/features/task/task-view.tsx": composition,
    "apps/web/src/components/ui/layout.tsx": composition,
  });
  deepEqual(
    result
      .filter((item) => item.rule === "import(max-dependencies)")
      .map((item) => item.file)
      .sort(),
    ["apps/web/src/components/ui/layout.tsx", "apps/web/src/features/task/task-view.tsx"],
  );
});
