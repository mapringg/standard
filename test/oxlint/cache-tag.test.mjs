import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("every use cache scope calls cacheTag from next/cache", (t) => {
  const diagnostics = lint(t, "cache-tag", {
    [`${S}/tagged.server.ts`]: 'import { cacheTag as tag } from "next/cache";\nexport async function a(id) {\n  "use cache: private";\n  tag(`a-${id}`);\n  return id;\n}\nexport const b = async () => { "use cache"; tag("b"); return 1; };\n',
    [`${S}/untagged.server.ts`]: 'import { cacheTag } from "next/cache";\nexport async function a() {\n  "use cache";\n  return 1;\n}\nexport async function nested() {\n  "use cache";\n  const run = () => cacheTag("x");\n  return run;\n}\nexport async function plain() { return 2; }\n',
    [`${S}/file.server.ts`]: '"use cache";\nimport { cacheTag } from "next/cache";\nexport async function tagged() { cacheTag("t"); return 1; }\nexport async function missing() { return 2; }\n',
    [`${S}/hidden.server.ts`]: '"use cache";\nimport { cacheTag } from "next/cache";\nasync function hidden() { return 1; }\nexport { hidden };\n',
    [`${S}/empty.server.ts`]: 'import { cacheTag } from "next/cache";\nexport async function a() { "use cache"; cacheTag(); return 1; }\n',
    [`${S}/spread.server.ts`]: 'import { cacheTag } from "next/cache";\nexport async function a() { "use cache"; cacheTag(...[]); return 1; }\nexport async function b(id) { "use cache"; cacheTag(id, ...[]); return 1; }\n',
    [`${S}/local.server.ts`]: 'const cacheTag = (tag) => tag;\nexport async function a() { "use cache"; cacheTag("x"); return 1; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/empty.server.ts`, `${S}/file.server.ts`, `${S}/hidden.server.ts`, `${S}/local.server.ts`, `${S}/spread.server.ts`, `${S}/untagged.server.ts`, `${S}/untagged.server.ts`]);
  assert.equal(diagnostics[1].message, "Call cacheTag from next/cache at the top of this use cache scope with a first tag that is not spread, such as cacheTag(key, ...more), and export each scope as an inline function, so a write can revalidate what it caches.");
});
