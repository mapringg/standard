import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("a Server Action parses each argument with the imported validator before anything else", (t) => {
  const diagnostics = lint(t, "action-schema", {
    [`${S}/schema.ts`]: 'import { z } from "zod"; export const input = z.string(); export const S = z.string();',
    [`${S}/zod.actions.ts`]: '"use server";\nimport { z } from "zod/mini";\nimport { input } from "./schema";\nconst local = z.object({ id: z.string() });\nexport async function rename(raw: unknown, other: unknown, form: FormData) {\n  const { id } = input.parse(raw);\n  const next = await z.parseAsync(input, other);\n  const fields = local.parse(Object.fromEntries(form));\n  return [id, next, fields];\n}\nexport const none = async () => 1;\nexport type Input = string;\n',
    [`${S}/valibot.actions.ts`]: '"use server";\nimport * as v from "valibot";\nimport { parse } from "valibot";\nimport { S } from "./schema";\nexport async function a(raw) { const x = v.parse(S, raw); return x; }\nexport async function b(raw) { parse(S, raw); return raw; }\n',
    [`${S}/late.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport { S } from "./schema";\nexport async function late(raw) { const client = await connect(); return S.parse(raw); }\nexport default async function first(raw, other) { S.parse(raw); return other; }\nexport const arrow = async ({ id }) => S.parse(id);\n',
    [`${S}/none.actions.ts`]: '"use server";\nimport { input } from "./schema";\nexport async function save(raw) { return input.parse(raw); }\n',
    [`${S}/inline.tsx`]: 'import { z } from "zod/mini";\nimport { S } from "./schema";\nexport function Page() {\n  async function save(raw) { "use server"; return raw; }\n  async function ok(raw) { "use server"; z.parse(S, raw); }\n  return null;\n}\n',
    [`${S}/client.ts`]: 'export async function rename(raw) { return raw; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/inline.tsx`, `${S}/late.actions.ts`, `${S}/late.actions.ts`, `${S}/late.actions.ts`, `${S}/none.actions.ts`]);
  assert.equal(diagnostics[0].message, "Parse raw with a schema before anything else, such as const input = schema.parse(raw), or schema.parse(Object.fromEntries(formData)) for a form, using the validator this file imports: zod, zod/mini or valibot.");
  assert.equal(diagnostics[2].message, "Parse other with a schema before anything else, such as const input = schema.parse(raw), or schema.parse(Object.fromEntries(formData)) for a form, using the validator this file imports: zod, zod/mini or valibot.");
});

test("only a throwing parse on an imported schema or a module schema counts", (t) => {
  const diagnostics = lint(t, "action-schema", {
    [`${S}/safe.actions.ts`]: '"use server";\nimport { input } from "./schema";\nimport { z } from "zod";\nexport async function a(raw) { input.safeParse(raw); return raw; }\n',
    [`${S}/json.actions.ts`]: '"use server";\nimport { z } from "zod";\nexport async function a(raw) { const x = JSON.parse(raw); return x; }\n',
    [`${S}/local.actions.ts`]: '"use server";\nimport { z } from "zod";\nexport async function a(raw) { const schema = z.string(); schema.parse(raw); return raw; }\n',
    [`${S}/plain.actions.ts`]: '"use server";\nimport { z } from "zod";\nconst parser = { parse: (value) => value };\nexport async function a(raw) { parser.parse(raw); return raw; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/json.actions.ts`, `${S}/local.actions.ts`, `${S}/plain.actions.ts`, `${S}/safe.actions.ts`]);
});

test("every export of a use server file is an inline function", (t) => {
  const diagnostics = lint(t, "action-schema", {
    [`${S}/forms.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport { S } from "./schema";\nasync function f(raw) { return raw; }\nexport { f };\nexport default f;\nexport const a = withAuth(async (raw) => raw);\nexport { g } from "./other";\nexport * from "./more";\nexport type T = string;\n',
  });
  assert.equal(diagnostics.length, 5, JSON.stringify(diagnostics));
  assert.equal(diagnostics[0].message, "Export each Server Action as an inline async function, export async function name(raw) {}, so its arguments can be checked.");
});

test("a schema is a project import or a module const built from the validator, never a package parser", (t) => {
  const diagnostics = lint(t, "action-schema", {
    "apps/web/package.json": { dependencies: { next: "16", react: "19", superjson: "2", yaml: "2" }, imports: { "#schema": "./src/schema.ts", "#superjson": "superjson" } },
    "apps/web/node_modules/superjson/package.json": { name: "superjson", main: "index.js" },
    "apps/web/node_modules/superjson/index.js": "export default { parse: (value) => value };",
    "apps/web/node_modules/yaml/package.json": { name: "yaml", main: "index.js" },
    "apps/web/node_modules/yaml/index.js": "export const parse = (value) => value; export default { parse };",
    [`${S}/schema.ts`]: 'import { z } from "zod"; export const input = z.string();',
    [`${S}/superjson.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport superjson from "superjson";\nexport async function a(raw) { superjson.parse(raw); return raw; }\n',
    [`${S}/yaml.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport YAML from "yaml";\nexport async function a(raw) { YAML.parse(raw); return raw; }\n',
    [`${S}/aliased.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport sj from "#superjson";\nexport async function a(raw) { sj.parse(raw); return raw; }\n',
    [`${S}/relative.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport { input } from "./schema";\nexport async function a(raw) { input.parse(raw); return raw; }\n',
    [`${S}/alias.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport { input } from "@/schema";\nexport async function a(raw) { input.parse(raw); return raw; }\n',
    [`${S}/imports.actions.ts`]: '"use server";\nimport { z } from "zod";\nimport { input } from "#schema";\nexport async function a(raw) { input.parse(raw); return raw; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/aliased.actions.ts`, `${S}/superjson.actions.ts`, `${S}/yaml.actions.ts`]);
});
