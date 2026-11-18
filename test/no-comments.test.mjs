import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("no-comments flags every comment and skips generated files", (t) => {
  const result = lint(t, {
    "packages/i18n/src/clean.ts": "export const a = 1;\n",
    "packages/i18n/src/line.ts": "export const a = 1; // note\n",
    "packages/i18n/src/block.ts": "/* note */\nexport const a = 1;\n",
    "packages/i18n/src/directive.ts": "// @ts-expect-error\nexport const a: number = 'x';\n",
    "packages/i18n/src/view.tsx": "export const View = () => <div>{/* note */}</div>;\n",
    "packages/i18n/src/cli.ts": "#!/usr/bin/env node\nexport const a = 1;\n",
    "packages/i18n/src/env.d.ts": '/// <reference types="vite/client" />\n',
  });
  deepEqual(filesWith(result, "no-comments"), [
    "packages/i18n/src/block.ts",
    "packages/i18n/src/directive.ts",
    "packages/i18n/src/line.ts",
    "packages/i18n/src/view.tsx",
  ]);
});
