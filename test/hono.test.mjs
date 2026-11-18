import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const head =
  'import { describeRoute } from "hono-openapi";\nimport { factory } from "@/factory";\nimport { v } from "@/lib/validate";\n';

test("hono checks chains, statuses, paths, docs and handler size", (t) => {
  const long = Array.from({ length: 10 }, (_, index) => `    const a${index} = ${index};`).join("\n");
  const result = lint(t, {
    "apps/api/src/features/tasks/routes.ts": `${head}export const tasks = factory
  .createApp()
  .get("/", describeRoute({}), async (c) => c.json([], 200))
  .post("/:id/archive", describeRoute({}), v("json", {}), async (c) => c.json(c.req.valid("json"), 201));
`,
    "apps/api/src/features/users/routes.ts": `${head}const app = factory.createApp();
app.get("/users", async (c) => c.json([]));
app.patch("/:id", describeRoute({}), async (c) => {
${long}
  return c.json(await c.req.json(), 200);
});
export const users = app;
`,
    "apps/api/src/features/notes/routes.ts": `${head}export const notes = factory
  .createApp()
  .get("/", describeRoute({}), async (ctx) => ctx.json([]))
  .delete("/:id", async (ctx) => ctx.body(null, 204));
`,
    "apps/api/src/app.ts": `import { openAPIRouteHandler } from "hono-openapi";
import { factory } from "@/factory";
import { tasks } from "@/features/tasks/routes";
import { env } from "@/lib/env";
const base = factory.createApp().route("/api/tasks", tasks).route("/api/v1/users", tasks);
export const app = env.NODE_ENV === "development" ? base.get("/api/openapi.json", openAPIRouteHandler(base)) : base;
export const leaked = base.get("/api/docs", openAPIRouteHandler(base));
`,
  });
  const found = only(result, "hono")
    .map((item) => `${item.file}: ${item.message.split(".")[0]}`)
    .sort();
  deepEqual(found, [
    "apps/api/src/app.ts: Mount routers at /api/<plural-kebab>",
    "apps/api/src/app.ts: Mount the OpenAPI spec and docs only when NODE_ENV is development",
    "apps/api/src/features/notes/routes.ts: Every route has describeRoute with its response schemas from schema",
    "apps/api/src/features/notes/routes.ts: Pass the status explicitly: c",
    "apps/api/src/features/users/routes.ts: A route handler is at most 10 lines",
    "apps/api/src/features/users/routes.ts: Build each router as one chain: factory",
    "apps/api/src/features/users/routes.ts: Build each router as one chain: factory",
    "apps/api/src/features/users/routes.ts: Every route has describeRoute with its response schemas from schema",
    "apps/api/src/features/users/routes.ts: Pass the status explicitly: c",
    "apps/api/src/features/users/routes.ts: Paths are / and /:id, plus POST /:id/<verb> for actions",
    "apps/api/src/features/users/routes.ts: Read input only through c",
  ]);
});
