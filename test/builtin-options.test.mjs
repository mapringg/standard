import { deepEqual } from "node:assert/strict";
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
