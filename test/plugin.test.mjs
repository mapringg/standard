import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const SNIPPETS = [
  "",
  "export const cleanup = () => () => 1;\nexport const pair = async (c: { json: () => number }) => c.json();\n",
  'export const { saveAction, ...restAction } = { saveAction: 1, other: 2 };\nexport const [firstAction = 1] = [];\nexport { saveAction as "quotedAction" };\n',
  'import * as R from "react";\nimport D, * as N from "react";\nexport const all = [R, D, N, R["useState"], N?.useEffect];\n',
  "export const View = () => <><span />{[1].map((n) => <>{n}</>)}</>;\n",
  'export default () => null;\nexport * from "@/lib/log";\nexport * as everything from "@/lib/log";\n',
  'const name = "x";\nexport const load = () => import(`@/lib/${name}`);\nexport const meta = import.meta;\n',
  "export class Box { #value = 1; static make() { return new Box(); } get value() { return this.#value; } }\n",
  "export function* walk() { label: for (const item of [1]) { yield item; continue label; } }\n",
  "export const pick = (a: { b?: { c?: () => number } }) => a.b?.c?.() ?? (0 as number) satisfies number;\n",
  "export const style = <div style={{ ...{} }} />;\nexport const props = <div {...{}} />;\n",
  '"use server";\n"use cache";\nexport const run = async () => 1;\n',
  '"use client";\nexport const retry = 1;\nexport const timers = { retry };\n',
];

const PATHS = [
  "apps/web/src/features/task/task-view.tsx",
  "apps/web/src/features/task/task-actions.ts",
  "apps/web/src/features/task/task-data.server.ts",
  "apps/web/src/features/task/task-cache.ts",
  "apps/web/src/features/task/task-state.ts",
  "apps/web/src/features/task/task-params.ts",
  "apps/web/src/features/task/task-view.test.tsx",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/layout.tsx",
  "apps/web/src/lib/query.ts",
  "apps/api/src/app.ts",
  "apps/api/src/factory.ts",
  "apps/api/src/features/tasks/routes.ts",
  "apps/api/src/features/tasks/db.ts",
  "apps/api/src/upstreams/vendor.ts",
  "apps/liff/src/app/index.tsx",
  "apps/mobile/src/features/task/task-view.tsx",
  "apps/marketing/src/pages/index.tsx",
  "apps/api/src/features/tasks/task.fixture.ts",
  "apps/api/vitest.config.ts",
];

const FRAMEWORK = { api: "hono", web: "next", liff: "vite", mobile: "expo", marketing: "astro" };

test("no plugin rule throws on odd but valid code", (t) => {
  const files = {};
  for (const [index, snippet] of SNIPPETS.entries()) {
    for (const [app, framework] of Object.entries(FRAMEWORK))
      files[`apps/${app}${index}/package.json`] = JSON.stringify({ dependencies: { [framework]: "1.0.0" } });
    for (const path of PATHS) {
      const file = path.replace(/^apps\/([a-z]+)\//, `apps/$1${index}/`);
      const jsx = snippet.includes("<");
      if (!(jsx && file.includes(".config."))) files[jsx ? file.replace(/\.ts$/, ".tsx") : file] = snippet;
    }
  }
  deepEqual(
    lint(t, files).filter((item) => !item.rule),
    [],
  );
});
