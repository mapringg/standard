import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint, only } from "./lint.mjs";

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
      'import { taskHref } from "#/features/task/task-params";\nexport const link = taskHref;\n',
    "apps/web/src/app/(app)/tasks/page.tsx":
      'import { tasks } from "#/features/task/task-data.server";\nexport default function Page() { return tasks; }\n',
    "apps/web/src/app/(app)/page.tsx":
      'export default function Page(props: PageProps<"/">) { return props.searchParams; }\n',
    "apps/web/src/features/task/task-view.tsx": "export const read = (url: URL) => url.searchParams;\n",
    "apps/web/src/features/task/task-list.tsx": "export const tasks = 1;\n",
    "apps/web/src/features/task/task-list.test.tsx":
      'import { expect, test } from "vitest";\nimport { tasks } from "#/features/task/task-list";\ntest("x", async () => { await expect.poll(() => tasks).toBe(1); });\n',
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

test("owners bans forwardRef in every UI app", (t) => {
  const result = lint(t, {
    "apps/web/src/components/ui/button.tsx":
      'import { forwardRef } from "react";\nexport const Button = forwardRef<HTMLButtonElement>((props, ref) => <button ref={ref} {...props} />);\n',
    "apps/web/src/components/ui/input.tsx":
      'import type { Ref } from "react";\nexport const Input = (props: { ref?: Ref<HTMLInputElement> }) => <input ref={props.ref} />;\n',
  });
  deepEqual(filesWith(result, "owners"), ["apps/web/src/components/ui/button.tsx"]);
});

test("owners confines UI primitive packages to components/ui in UI apps", (t) => {
  const result = lint(t, {
    "apps/web/src/components/ui/button.tsx": 'export { Button } from "@ui-sdk/react";\n',
    "apps/web/src/features/task/task-button.tsx": 'export { Button } from "@ui-sdk/react";\n',
    "apps/web/src/features/task/task-dialog.tsx": 'export { Dialog } from "@base-ui-components/react/dialog";\n',
    "apps/mobile/src/features/task/task-text.tsx": 'export { Text } from "@rn-primitives/slot";\n',
    "apps/api/src/features/tasks/view.ts": 'export { Button } from "@ui-sdk/react";\n',
    "apps/web/src/features/task/task-sdk.ts": 'export { client } from "ui-sdk";\n',
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/mobile/src/features/task/task-text.tsx",
    "apps/web/src/features/task/task-button.tsx",
    "apps/web/src/features/task/task-dialog.tsx",
  ]);
});

test("owners lets an owner file's own test use what the owner owns", (t) => {
  const result = lint(t, {
    "apps/web/src/lib/log.ts": "export const log = (message: string) => console.log(message);\n",
    "apps/web/src/lib/log.test.ts": "export const spy = () => console.log;\n",
    "apps/web/src/lib/query.ts": 'export { QueryClient } from "@tanstack/react-query";\n',
    "apps/web/src/lib/query.test.ts": 'export { QueryClient } from "@tanstack/react-query";\n',
    "apps/web/src/components/boundary/section.tsx": 'export { Suspense } from "react";\n',
    "apps/web/src/components/boundary/section.test.tsx": 'export { Suspense } from "react";\n',
    "apps/web/src/lib/format.ts": "export const format = (n: number) => n.toLocaleString();\n",
    "apps/web/src/lib/format.test.ts": "export const format = (n: number) => n.toLocaleString();\n",
    "apps/web/src/lib/clock.ts": "export const now = () => 1;\n",
    "apps/web/src/lib/clock.test.ts": "export const spy = () => console.log;\n",
    "apps/web/src/features/task/log.ts": "export const log = 1;\n",
    "apps/web/src/features/task/log.test.ts": "export const spy = () => console.log;\n",
    "apps/api/src/features/tasks/db.ts": 'import postgres from "postgres";\nexport const sql = postgres;\n',
    "apps/api/src/features/tasks/db.test.ts": 'import postgres from "postgres";\nexport const sql = postgres;\n',
    "apps/api/src/lib/env.ts": "export const port = process.env.PORT;\n",
    "apps/api/src/lib/env.test.ts": "export const port = process.env.PORT;\n",
  });
  deepEqual(filesWith(result, "owners"), ["apps/web/src/features/task/log.test.ts", "apps/web/src/lib/clock.test.ts"]);
});

test("owners lets a database suite inherit its owner's permissions", (t) => {
  const mongoose = 'import mongoose from "mongoose";\nexport const db = mongoose;\n';
  const result = lint(t, {
    "apps/api/src/features/x/db.ts": mongoose,
    "apps/api/src/features/x/db.mongo.test.ts": mongoose,
    "apps/api/src/features/x/db.redis.test.ts": mongoose,
    "apps/api/src/features/x/service.ts": "export const run = 1;\n",
    "apps/api/src/features/x/service.mongo.test.ts": mongoose,
    "apps/web/src/lib/log.ts": "export const log = (message: string) => console.log(message);\n",
    "apps/web/src/lib/log.browser.test.ts": "export const spy = () => console.log;\n",
  });
  deepEqual(filesWith(result, "owners"), ["apps/api/src/features/x/service.mongo.test.ts"]);
});

test("owners flags only Set-Cookie reads that obtain the value", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-has.ts": 'export const has = (h: Headers) => h.has("set-cookie");\n',
    "apps/web/src/features/task/task-get.ts": 'export const get = (h: Headers) => h.get("set-cookie");\n',
  });
  deepEqual(filesWith(result, "owners"), ["apps/web/src/features/task/task-get.ts"]);
});

test("owners treats React.X like the named import", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-suspense.tsx":
      'import * as React from "react";\nexport const View = () => <React.Suspense fallback={null}><div /></React.Suspense>;\n',
    "apps/web/src/features/task/task-default.tsx":
      'import React from "react";\nexport const View = () => <React.Suspense fallback={null}><div /></React.Suspense>;\n',
    "apps/web/src/features/task/task-state.tsx":
      'import * as React from "react";\nexport const useOpen = () => React.useState(false);\n',
    "apps/web/src/features/task/task-fragment.tsx":
      'import * as React from "react";\nexport const View = () => <React.Fragment><div /></React.Fragment>;\n',
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/web/src/features/task/task-default.tsx",
    "apps/web/src/features/task/task-state.tsx",
    "apps/web/src/features/task/task-suspense.tsx",
  ]);
});

test("owners lets only the cookie helper touch document.cookie", (t) => {
  const write = "export const write = (value: string) => {\n  document.cookie = value;\n};\n";
  const result = lint(t, {
    "apps/web/src/lib/cookie.browser.ts": write,
    "apps/web/src/features/task/task-cookie.ts": write,
    "apps/web/src/features/task/task-read.ts": "export const read = () => document.cookie;\n",
  });
  deepEqual(
    only(result, "owners")
      .map((item) => `${item.file} ${item.message}`)
      .sort(),
    [
      "apps/web/src/features/task/task-cookie.ts Read and write cookies through the helper in #/lib/cookie.browser.",
      "apps/web/src/features/task/task-read.ts Read and write cookies through the helper in #/lib/cookie.browser.",
    ],
  );
});

test("owners lets API tests reach an Express server and paths outside the typed client", (t) => {
  const result = lint(t, {
    "apps/api/src/lib/mcp/broker.ts": "export const broker = 1;\n",
    "apps/api/src/lib/mcp/broker.test.ts": [
      'import express from "express";',
      "",
      "const server = express().listen(0);",
      "export const token = () => fetch(`http://127.0.0.1:${String(server.address())}/token`);",
      "",
    ].join("\n"),
    "apps/api/src/app.ts": "export const app = { request: (path: string) => path };\n",
    "apps/api/src/app.test.ts": [
      'import { app } from "#/app";',
      "",
      'export const missing = () => app.request("/mcp");',
      'export const known = () => app.request("/.well-known/oauth-authorization-server");',
      "",
    ].join("\n"),
    "apps/api/src/features/tasks/routes.ts": "export const routes = 1;\n",
    "apps/api/src/features/tasks/routes.test.ts": [
      'import { app } from "#/app";',
      "",
      'export const list = () => app.request("/api/tasks");',
      'export const load = () => fetch("http://127.0.0.1/api/tasks");',
      "",
    ].join("\n"),
  });
  deepEqual(
    only(result, "owners")
      .map((item) => `${item.file} ${item.message}`)
      .sort(),
    [
      "apps/api/src/features/tasks/routes.test.ts Call /api routes through testClient().",
      "apps/api/src/features/tasks/routes.test.ts Call outside services through src/upstreams/<vendor>.ts with a timeout; a test may fetch a server it starts with .listen(port).",
    ],
  );
});

test("owners allows shared server i18n in route files only", (t) => {
  const result = lint(t, {
    "apps/web/src/app/[lang]/page.tsx":
      'import { pageTitle } from "#/lib/i18n.server.ts"; export const generateMetadata = pageTitle("home");',
    "apps/web/src/app/[lang]/layout.tsx":
      'import { getLocale, getTranslator } from "#/lib/i18n.server"; export const locale = getLocale(getTranslator());',
    "apps/web/src/app/[lang]/template.tsx": 'export { pageTitle } from "#/lib/i18n.server.ts";',
    "apps/web/src/app/private/page.tsx": 'export { load } from "#/lib/data.server.ts";',
  });
  deepEqual(filesWith(result, "owners"), ["apps/web/src/app/private/page.tsx"]);
});

test("owners allows only Next runtime detection in web instrumentation", (t) => {
  const runtime = 'if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node.ts");';
  const result = lint(t, {
    "apps/web/src/instrumentation.ts": runtime,
    "apps/web/src/lib/instrumentation.ts": runtime,
    "apps/api/src/instrumentation.ts": runtime,
    "apps/web/src/features/task/task-runtime.ts": runtime,
    "apps/web/src/instrumentation-client.ts": "export const key = process.env.API_KEY;",
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/api/src/instrumentation.ts",
    "apps/web/src/features/task/task-runtime.ts",
    "apps/web/src/instrumentation-client.ts",
    "apps/web/src/lib/instrumentation.ts",
  ]);
  deepEqual(
    filesWith(lint(t, { "apps/web/src/instrumentation.ts": "export const key = process.env.API_KEY;" }), "owners"),
    ["apps/web/src/instrumentation.ts"],
  );
});

test("owners allows env passthrough only in test utilities and fixtures", (t) => {
  const spread =
    'import { spawn } from "node:child_process"; export const child = spawn("pnpm", [], { env: { ...process.env, API_URL: "http://localhost" } });';
  const result = lint(t, {
    "apps/api/src/lib/broker.test-utils.ts": spread,
    "apps/web/src/lib/broker.fixture.tsx": spread,
    "apps/web/src/lib/broker.test-utils.mts": spread,
    "apps/api/src/lib/broker.ts": spread,
    "apps/api/src/lib/broker.test.ts": spread,
    "apps/api/src/lib/read.test-utils.ts": "export const key = process.env.API_KEY;",
    "apps/api/src/lib/read.fixture.ts": "export const env = process.env;",
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/api/src/lib/broker.test.ts",
    "apps/api/src/lib/broker.ts",
    "apps/api/src/lib/read.fixture.ts",
    "apps/api/src/lib/read.test-utils.ts",
  ]);
});

test("owners allows API test fetch when the file starts a local HTTP server", (t) => {
  const local =
    'import { createMcpBrokerApp } from "#/lib/broker"; export const server = createMcpBrokerApp().listen(0); export const load = (path: string, broker: { url: string }, init: RequestInit) => fetch(new URL(path, broker.url), init);';
  const result = lint(t, {
    "apps/api/src/lib/broker.test-utils.ts": local,
    "apps/api/src/lib/broker.test.ts": local,
    "apps/api/src/lib/broker.fixture.ts": local,
    "apps/api/src/lib/broker.ts": local,
    "apps/web/src/lib/broker.test-utils.ts": local,
    "apps/api/src/lib/remote.test.ts": 'export const load = () => fetch("https://example.com");',
    "apps/api/src/lib/msw.test-utils.ts":
      'server.listen({ onUnhandledRequest: "error" }); export const load = () => fetch("https://example.com");',
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/api/src/lib/broker.ts",
    "apps/api/src/lib/msw.test-utils.ts",
    "apps/api/src/lib/remote.test.ts",
    "apps/web/src/lib/broker.test-utils.ts",
  ]);
});

test("owners checks app request factories and static template paths", (t) => {
  const result = lint(t, {
    "apps/api/src/app.test.ts":
      'export const load = () => app.request(`/mcp`); export const missing = () => createApp().request("/mcp");',
    "apps/api/src/lib/api.test.ts": "export const load = () => createApp().request(`/api/tasks`);",
    "apps/api/src/lib/root.test.ts": 'export const load = () => app.request("/api");',
    "apps/api/src/lib/dynamic.test.ts": "export const load = (path: string) => createApp().request(`/${path}`);",
    "apps/api/src/lib/unknown.test.ts": "export const load = (path: string) => app.request(path);",
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/api/src/lib/api.test.ts",
    "apps/api/src/lib/dynamic.test.ts",
    "apps/api/src/lib/root.test.ts",
    "apps/api/src/lib/unknown.test.ts",
  ]);
});

test("owners accepts shared URL params modules and keeps UI parsers centralized", (t) => {
  const query = "export const read = (url: URL) => new URLSearchParams(url.searchParams);\n";
  const result = lint(t, {
    "apps/web/src/lib/compare-params.ts": query,
    "apps/web/src/lib/auth/return-params.ts": query,
    "apps/web/src/lib/compare-params.test.ts": query,
    "apps/web/src/lib/compare-url.ts": query,
    "apps/web/src/components/compare/compare-link.tsx": query,
    "apps/web/src/features/search/search-params.ts": query,
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/web/src/components/compare/compare-link.tsx",
    "apps/web/src/lib/compare-url.ts",
  ]);
});

test("owners allows the Next.js query hook only in the shared route params module", (t) => {
  const hook = 'import { useSearchParams } from "next/navigation";\nexport const useQuery = () => useSearchParams();\n';
  const result = lint(t, {
    "apps/web/src/lib/next-route-params.ts": hook,
    "apps/web/src/lib/search-params.ts": hook,
    "apps/web/src/features/search/search-params.ts": hook,
    "apps/web/src/components/search/search-view.tsx":
      'import { useSearchParams as useQuery } from "next/navigation";\nexport const useParams = () => useQuery();\n',
    "apps/web/src/components/search/search-panel.tsx":
      'import { useQuery } from "#/lib/next-route-params.ts";\nexport const useParams = () => useQuery();\n',
  });
  deepEqual(filesWith(result, "owners"), [
    "apps/web/src/components/search/search-view.tsx",
    "apps/web/src/features/search/search-params.ts",
    "apps/web/src/lib/search-params.ts",
  ]);
});
