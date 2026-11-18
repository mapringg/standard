import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("owners lets only owner files use what they own", (t) => {
  const result = lint(t, {
    "apps/web/src/lib/log.ts": "export const log = (message: string) => console.log(message);\n",
    "apps/web/src/features/task/task-log.ts": "export const log = (message: string) => console.log(message);\n",
    "apps/web/src/components/ui/dialog.tsx": 'import { useEffect } from "react";\nexport const use = useEffect;\n',
    "apps/web/src/features/task/task-effect.tsx": 'import { useEffect } from "react";\nexport const use = useEffect;\n',
    "apps/web/src/features/task/task-reexport.ts": 'export { useState } from "react";\n',
    "apps/web/src/features/task/task-client.ts": 'export { hc } from "hono/client";\n',
    "apps/web/src/features/task/task-namespace.tsx": 'import * as R from "react";\nexport const use = R.useEffect;\n',
    "apps/web/src/features/task/task-hook.tsx": 'import React from "react";\nexport const use = React.useState;\n',
    "apps/web/src/features/task/task-timer.ts": "export const later = () => window.setTimeout(() => 1, 1);\n",
    "apps/web/src/features/task/task-parse.ts": "export const parse = (text: string) => globalThis.JSON.parse(text);\n",
    "apps/web/src/features/task/task-fetch.ts": 'export const load = () => fetch("/api/tasks");\n',
    "apps/web/src/lib/api/client.ts": 'export const load = () => fetch("/api/tasks");\n',
    "apps/web/src/lib/task-link.ts":
      'import { taskHref } from "@/features/task/task-params";\nexport const link = taskHref;\n',
    "apps/web/src/app/(app)/tasks/page.tsx":
      'import { tasks } from "@/features/task/task-data.server";\nexport default function Page() { return tasks; }\n',
    "apps/web/src/app/(app)/page.tsx":
      'export default function Page(props: PageProps<"/">) { return props.searchParams; }\n',
    "apps/web/src/features/task/task-view.tsx": "export const read = (url: URL) => url.searchParams;\n",
    "apps/web/src/features/task/task-list.tsx": "export const tasks = 1;\n",
    "apps/web/src/features/task/task-list.test.tsx":
      'import { expect, test } from "vitest";\nimport { tasks } from "@/features/task/task-list";\ntest("x", async () => { await expect.poll(() => tasks).toBe(1); });\n',
    "apps/api/src/lib/env.ts": "export const port = process.env.PORT;\n",
    "apps/api/src/features/tasks/db.ts": 'import postgres from "postgres";\nexport const sql = postgres;\n',
    "apps/api/src/features/tasks/service.ts":
      'import postgres from "postgres";\nexport const sql = [postgres, process.env.PORT];\n',
    "apps/api/src/features/tasks/routes.ts":
      "export const handle = (app: { onError: (f: () => void) => void }) => app.onError(() => undefined);\n",
    "apps/api/src/app.ts":
      "export const handle = (app: { onError: (f: () => void) => void }) => app.onError(() => undefined);\n",
    "apps/api/src/middleware/public-routes.ts": 'export const publicRoutes = ["/api/*"];\n',
    "apps/api/src/middleware/auth.ts": 'export const publicRoutes = ["/api/health"];\n',
    "apps/email/package.json": JSON.stringify({ dependencies: { hono: "1.0.0" } }),
    "apps/api/src/features/oauth/routes.ts":
      "export const handle = (app: { onError: (f: () => void) => void }) => app.onError(() => undefined);\n",
    "apps/web/src/lib/api/session.ts": 'export const cookie = (h: Headers) => h.get("set-cookie");\n',
    "apps/web/src/features/task/task-cookie.ts": "export const cookies = (h: Headers) => h.getSetCookie();\n",
    "apps/web/src/features/task/task-forward.ts": 'export const name = "Set-Cookie";\n',
    "apps/email/src/features/mail/db.ts": 'export const load = () => fetch("https://mail.example");\n',
    "apps/liff/src/lib/env.ts": "export const url = import.meta.env.VITE_API_URL;\n",
    "apps/liff/src/features/task/task-api.ts": "export const url = import.meta.env.VITE_API_URL;\n",
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/api/src/features/tasks/routes.ts",
    "apps/api/src/features/tasks/service.ts",
    "apps/api/src/middleware/auth.ts",
    "apps/email/src/features/mail/db.ts",
    "apps/liff/src/features/task/task-api.ts",
    "apps/web/src/app/(app)/tasks/page.tsx",
    "apps/web/src/features/task/task-client.ts",
    "apps/web/src/features/task/task-cookie.ts",
    "apps/web/src/features/task/task-effect.tsx",
    "apps/web/src/features/task/task-fetch.ts",
    "apps/web/src/features/task/task-forward.ts",
    "apps/web/src/features/task/task-hook.tsx",
    "apps/web/src/features/task/task-list.test.tsx",
    "apps/web/src/features/task/task-log.ts",
    "apps/web/src/features/task/task-namespace.tsx",
    "apps/web/src/features/task/task-parse.ts",
    "apps/web/src/features/task/task-reexport.ts",
    "apps/web/src/features/task/task-timer.ts",
    "apps/web/src/features/task/task-view.tsx",
    "apps/web/src/lib/task-link.ts",
  ]);
});

test("owners ignores a local binding that shadows a react namespace", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-shadow.tsx":
      'import * as R from "react";\nexport const node = R.createElement("div");\nexport function read(R: { useEffect: () => number }) { return R.useEffect(); }\n',
  });
  deepEqual(filesWith(result, "owners"), []);
});
