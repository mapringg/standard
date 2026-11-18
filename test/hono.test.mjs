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
  .get("/current", describeRoute({}), async (c) => c.json({}, 200))
  .get("/live", describeRoute({}), async (c) => streamSSE(c, async () => c.json({})))
  .post("/:id/archive", describeRoute({}), v("json", {}), async (c) => c.json(c.req.valid("json"), 201));
`,
    "apps/api/src/features/users/routes.ts": `${head}const app = factory.createApp();
app.get("/users/:id/x", async (c) => c.json([]));
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
    "apps/api/src/features/webhooks/routes.ts": `${head}export const webhooks = factory
  .createApp()
  .post("/line", describeRoute({}), async (c) => c.json({ body: await c.req.text() }, 200));
`,
    "apps/api/src/features/files/routes.ts": `${head}const cache = new Map();
export const files = factory
  .createApp()
  .get("/:id", describeRoute({}), async (c) => c.body(cache.get("x")))
  .post("/", describeRoute({}), v("form", {}), async (c) => c.json(c.req.valid("form"), 201))
  .post("/upload", describeRoute({}), bodyLimit({ maxSize: 1 }), v("form", {}), async (c) => c.body(null, 204))
  .get(\`/\${"x"}\`, describeRoute({}), async (c) => c.json({}, 200))
  .all("/any", describeRoute({}), async (c) => c.json({}, 200));
`,
    "apps/api/src/features/oauth/routes.ts": `${head}export const oauth = factory
  .createApp()
  .onError((error, c) => c.json({ error: "server_error" }, 500))
  .post("/token", describeRoute({}), async (c) => {
${long}
    return c.json({ access_token: "x" }, 200);
  });
`,
    "apps/api/src/upstreams/vendor.ts": "export const parse = async (response: Response) => response.json();\n",
    "apps/api/src/middleware/guard.ts":
      'import { createMiddleware } from "hono/factory";\nexport const guard = createMiddleware(async (c) => c.json({}));\n',
    "apps/api/src/app.ts": `import { openAPIRouteHandler } from "hono-openapi";
import { factory } from "@/factory";
import { tasks } from "@/features/tasks/routes";
import { env } from "@/lib/env";
const base = factory.createApp().route("/api/tasks", tasks).route("/api/v1/users", tasks);
export const app = env.NODE_ENV === "development" ? base.get("/api/openapi.json", openAPIRouteHandler(base)) : base;
export const leaked = base.get("/api/docs", openAPIRouteHandler(base));
export const inverted = env.NODE_ENV !== "development" ? base.get("/api/spec", openAPIRouteHandler(base)) : base;
export const named = env.NODE_ENV === "development-like" && openAPIRouteHandler(base);
`,
  });
  const found = only(result, "hono")
    .map((item) => `${item.file}: ${item.message.split(".")[0]}`)
    .sort();
  deepEqual(found, [
    "apps/api/src/app.ts: Mount routers at /api/<plural-kebab>",
    "apps/api/src/app.ts: Mount the OpenAPI spec and docs only inside env",
    "apps/api/src/app.ts: Mount the OpenAPI spec and docs only inside env",
    "apps/api/src/app.ts: Mount the OpenAPI spec and docs only inside env",
    'apps/api/src/features/files/routes.ts: Add bodyLimit({ maxSize }) before v("form", schema) to cap the upload size',
    "apps/api/src/features/files/routes.ts: Pass the status explicitly: c",
    "apps/api/src/features/files/routes.ts: Register each route with get, post, patch or delete",
    "apps/api/src/features/files/routes.ts: Write the route path as a string literal",
    "apps/api/src/features/notes/routes.ts: Add describeRoute with the response schemas from schema",
    "apps/api/src/features/notes/routes.ts: Pass the status explicitly: c",
    "apps/api/src/features/users/routes.ts: Add describeRoute with the response schemas from schema",
    "apps/api/src/features/users/routes.ts: Build each router as one chain: factory",
    "apps/api/src/features/users/routes.ts: Build each router as one chain: factory",
    "apps/api/src/features/users/routes.ts: Move the logic into db",
    "apps/api/src/features/users/routes.ts: Pass the status explicitly: c",
    "apps/api/src/features/users/routes.ts: Use /, /:id, /<kebab-name> or POST /:id/<kebab-verb> as the path",
    "apps/api/src/features/users/routes.ts: Validate with v() from @/lib/validate and read the input with c",
    "apps/api/src/middleware/guard.ts: Pass the status explicitly: c",
  ]);
});
