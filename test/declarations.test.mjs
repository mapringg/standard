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
