import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("a Server Action parses each argument with the imported validator before anything else", (t) => {
  const diagnostics = lint(t, "action-schema", {
    [`${S}/zod.actions.ts`]: '"use server";\nimport { z } from "zod/mini";\nimport { input } from "./schema";\nexport async function rename(raw: unknown, other: unknown) {\n  const { id } = input.parse(raw);\n  const next = await z.parseAsync(input, other);\n  return [id, next];\n}\nexport const none = async () => 1;\nasync function helper(raw: unknown) { return raw; }\n',
    [`${S}/valibot.actions.ts`]: '"use server";\nimport * as v from "valibot";\nimport { parse } from "valibot";\nexport async function a(raw) { const x = v.parse(S, raw); return x; }\nexport async function b(raw) { parse(S, raw); return raw; }\n',
    [`${S}/late.actions.ts`]: '"use server";\nimport { z } from "zod";\nexport async function late(raw) { const client = await connect(); return S.parse(raw); }\nexport default async function first(raw, other) { S.parse(raw); return other; }\nexport const arrow = async ({ id }) => S.parse(id);\n',
    [`${S}/none.actions.ts`]: '"use server";\nimport { input } from "./schema";\nexport async function save(raw) { return input.parse(raw); }\n',
    [`${S}/inline.tsx`]: 'import { z } from "zod/mini";\nexport function Page() {\n  async function save(raw) { "use server"; return raw; }\n  async function ok(raw) { "use server"; z.parse(S, raw); }\n  return null;\n}\n',
    [`${S}/client.ts`]: 'export async function rename(raw) { return raw; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/inline.tsx`, `${S}/late.actions.ts`, `${S}/late.actions.ts`, `${S}/late.actions.ts`, `${S}/none.actions.ts`]);
  assert.equal(diagnostics[0].message, "Parse each argument with a schema before anything else, such as const input = schema.parse(raw), using the validator this file imports: zod, zod/mini or valibot.");
});
