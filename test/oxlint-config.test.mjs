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
    "apps/web/src/features/task/task-timer.ts": "export const later = () => window.setTimeout(() => 1, 1);\n",
    "apps/web/src/features/task/task-parse.ts": "export const parse = (text: string) => globalThis.JSON.parse(text);\n",
    "apps/web/src/features/task/task-hook.tsx": 'import React from "react";\nexport const use = React.useState;\n',
    "apps/web/src/features/task/task-fetch.ts": 'export const load = () => fetch("/api/tasks");\n',
    "apps/web/src/lib/api/client.browser.ts": 'export const load = () => fetch("/api/tasks");\n',
    "apps/web/src/lib/task-link.ts":
      'import { taskHref } from "@/features/task/task-params";\nexport const link = taskHref;\n',
    "apps/web/src/app/(app)/tasks/page.tsx":
      'import { tasks } from "@/features/task/task-data.server";\nexport default function Page() { return tasks; }\n',
    "apps/web/src/features/task/task-search.tsx": 'export const Search = () => <input placeholder="Search" />;\n',
    "apps/api/src/features/tasks/routes.ts":
      "export const handle = (app: { onError: (f: () => void) => void }) => app.onError(() => undefined);\n",
    "apps/api/src/app.ts":
      "export const handle = (app: { onError: (f: () => void) => void }) => app.onError(() => undefined);\n",
    "apps/api/src/middleware/public-routes.ts": 'export const publicRoutes = ["/api/*"];\n',
    "apps/api/src/middleware/auth.ts": 'export const publicRoutes = ["/api/health"];\n',
  });
  const found = result
    .filter((item) => /no-restricted-(?:imports|globals|properties|exports)|jsx-no-literals/.test(item.rule))
    .map((item) => `${item.file} ${item.rule}`)
    .sort();
  deepEqual(
    found,
    [
      "apps/api/src/features/tasks/routes.ts eslint(no-restricted-properties)",
      "apps/api/src/features/tasks/service.ts eslint(no-restricted-imports)",
      "apps/api/src/middleware/auth.ts eslint(no-restricted-exports)",
      "apps/web/src/app/(app)/tasks/page.tsx eslint(no-restricted-imports)",
      "apps/web/src/features/task/task-fetch.ts eslint(no-restricted-globals)",
      "apps/web/src/features/task/task-hook.tsx eslint(no-restricted-properties)",
      "apps/web/src/features/task/task-parse.ts eslint(no-restricted-properties)",
      "apps/web/src/features/task/task-search.tsx react(jsx-no-literals)",
      "apps/web/src/features/task/task-timer.ts eslint(no-restricted-properties)",
      "apps/web/src/lib/task-link.ts eslint(no-restricted-imports)",
      "apps/api/src/features/tasks/service.ts eslint(no-restricted-properties)",
      "apps/web/src/features/task/task-effect.tsx eslint(no-restricted-imports)",
      "apps/web/src/features/task/task-list.test.tsx eslint(no-restricted-properties)",
      "apps/web/src/features/task/task-log.ts eslint(no-restricted-globals)",
      "apps/web/src/features/task/task-view.tsx eslint(no-restricted-properties)",
    ].sort(),
  );
});
