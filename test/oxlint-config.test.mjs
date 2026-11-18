import { deepEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { config } from "../scripts/oxlint-config.mjs";
import { lint } from "./lint.mjs";

test("oxlint.json matches scripts/oxlint-config.mjs", () => {
  deepEqual(JSON.parse(readFileSync(join(import.meta.dirname, "../oxlint.json"), "utf8")), config());
});

test("owner files are the only users of what they own", (t) => {
  const result = lint(t, {
    "apps/web/src/lib/log.ts": "export const log = (message: string) => console.log(message);\n",
    "apps/web/src/features/task/task-log.ts": "export const log = (message: string) => console.log(message);\n",
    "apps/web/src/components/ui/dialog.tsx": 'import { useEffect } from "react";\nexport const use = useEffect;\n',
    "apps/web/src/features/task/task-effect.tsx": 'import { useEffect } from "react";\nexport const use = useEffect;\n',
    "apps/web/src/app/(app)/page.tsx":
      'export default function Page(props: PageProps<"/">) { return props.searchParams; }\n',
    "apps/web/src/features/task/task-view.tsx": "export const read = (url: URL) => url.searchParams;\n",
    "apps/api/src/lib/env.ts": "export const port = process.env.PORT;\n",
    "apps/api/src/features/tasks/db.ts": 'import postgres from "postgres";\nexport const sql = postgres;\n',
    "apps/api/src/features/tasks/service.ts":
      'import postgres from "postgres";\nexport const sql = [postgres, process.env.PORT];\n',
    "apps/web/src/features/task/task-list.tsx": "export const tasks = 1;\n",
    "apps/web/src/features/task/task-list.test.tsx":
      'import { expect, test } from "vitest";\nimport { tasks } from "@/features/task/task-list";\ntest("x", async () => { await expect.poll(() => tasks).toBe(1); });\n',
  });
  const found = result
    .filter((item) => /no-restricted-(?:imports|globals|properties)/.test(item.rule))
    .map((item) => `${item.file} ${item.rule}`)
    .sort();
  deepEqual(found, [
    "apps/api/src/features/tasks/service.ts eslint(no-restricted-imports)",
    "apps/api/src/features/tasks/service.ts eslint(no-restricted-properties)",
    "apps/web/src/features/task/task-effect.tsx eslint(no-restricted-imports)",
    "apps/web/src/features/task/task-list.test.tsx eslint(no-restricted-properties)",
    "apps/web/src/features/task/task-log.ts eslint(no-restricted-globals)",
    "apps/web/src/features/task/task-view.tsx eslint(no-restricted-properties)",
  ]);
});
