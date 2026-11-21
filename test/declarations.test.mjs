import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

test("a d.ts file can add CSS custom properties to React's CSSProperties", (t) => {
  const result = lint(t, {
    "apps/web/src/css.d.ts": [
      'import "react";',
      "",
      'declare module "react" {',
      "  interface CSSProperties {",
      "    [key: `--${string}`]: string | number;",
      "  }",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/lib/style.ts": "export interface Style {\n  [key: string]: string;\n}\n",
  });
  deepEqual(
    result.filter((item) => item.rule === "typescript(consistent-indexed-object-style)").map((item) => item.file),
    ["apps/web/src/lib/style.ts"],
  );
});

test("ambient and generated files can retain their declaration shape", (t) => {
  const ambient = "declare const runtime: string;\n";
  const header = "/* eslint-disable */\n";
  const result = lint(t, {
    "apps/api/client-env.d.ts": ambient,
    "apps/api/worker-configuration.d.ts": header + ambient,
    "apps/api/src/lib/unrelated.ts": header + ambient,
  });
  deepEqual(
    result
      .filter((item) => ["import(unambiguous)", "unicorn(no-abusive-eslint-disable)"].includes(item.rule))
      .map((item) => `${item.file} ${item.rule}`)
      .sort(),
    [
      "apps/api/src/lib/unrelated.ts import(unambiguous)",
      "apps/api/src/lib/unrelated.ts unicorn(no-abusive-eslint-disable)",
    ],
  );
});
