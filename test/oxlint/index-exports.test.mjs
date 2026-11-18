import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("a plain index carries no server-only or API module", (t) => {
  const diagnostics = lint(t, "index-exports", {
    [`${S}/features/a/index.ts`]: 'export * from "./load.server";\n',
    [`${S}/features/b/index.ts`]: 'export { getUser } from "@/lib/api/users";\n',
    [`${S}/features/c/index.tsx`]: 'import { load } from "./load.server.ts";\nexport { load };\n',
    [`${S}/features/d/index.ts`]: 'export { View } from "./view";\nexport type { Row } from "./rows.server";\n',
    [`${S}/features/e/index.server.ts`]: 'export * from "./load.server";\nexport { getUser } from "@/lib/api/users";\n',
    [`${S}/features/f/other.ts`]: 'export * from "./load.server";\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/features/a/index.ts`, `${S}/features/b/index.ts`, `${S}/features/c/index.tsx`]);
  assert.equal(diagnostics[0].message, "Move ./load.server to this module's index.server entry; a plain index may reach the browser, so it carries no *.server.* or src/lib/api module.");
});
