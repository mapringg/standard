import { deepEqual } from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const code = "export const a = 1;\n";
const extends_ = [join(import.meta.dirname, "../oxlint.json")];

function findings(t, files) {
  return only(lint(t, { "apps/web/src/lib/log.ts": code, ...files }), "design-system")
    .map((item) => `${item.file} | ${item.message}`)
    .sort();
}

test("design-system allows a rule turned off while upgrading", (t) => {
  deepEqual(
    findings(t, {
      ".oxlintrc.json": JSON.stringify({
        extends: extends_,
        rules: { "shadcn/no-restyle": "off", "eslint/no-console": "error" },
      }),
    }),
    [],
  );
});

test("design-system rejects loosened options, overrides and settings", (t) => {
  deepEqual(
    findings(t, {
      ".oxlintrc.json": JSON.stringify({
        extends: extends_,
        settings: { shadcn: { ui: "@/ds" } },
        rules: { "shadcn/no-restyle": ["error", { allow: ["layout", "spacing"] }] },
        overrides: [{ files: ["src/features/**"], rules: { "shadcn/no-raw-colors": "off" } }],
      }),
    }),
    [
      "apps/web/src/lib/log.ts | .oxlintrc.json: Delete settings.shadcn and import components from #/components/ui as Standard expects.",
      "apps/web/src/lib/log.ts | .oxlintrc.json: Delete the shadcn/no-raw-colors override and fix those files, or change the standard.",
      "apps/web/src/lib/log.ts | .oxlintrc.json: Delete the shadcn/no-restyle setting and fix the code with a variant, size, margin or a new component variant.",
    ],
  );
});
