import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("only use server files, route handlers and the AI owner import src/lib/ai", (t) => {
  const diagnostics = lint(t, "ai-render", {
    [`${S}/lib/ai.ts`]: "export async function generateSummary() { return 1; }\nexport const model = 1;\n",
    [`${S}/lib/ai.server.ts`]: 'export { generateSummary } from "./ai";\n',
    [`${S}/lib/other.ts`]: 'import { model } from "./ai";\nexport { model };\n',
    [`${S}/app/page.tsx`]: 'import { generateSummary } from "@/lib/ai";\nexport default async function Page() { return <p>{await generateSummary()}</p>; }\n',
    [`${S}/app/dynamic/page.tsx`]: 'export default async function Page() { const { model } = await import("@/lib/ai.server"); return <p>{model}</p>; }\n',
    [`${S}/features/summary/summary.server.ts`]: 'import { generateSummary } from "@/lib/ai";\nexport async function summarize() { return generateSummary(); }\n',
    [`${S}/features/summary/summary.actions.ts`]: '"use server";\nimport { generateSummary } from "@/lib/ai";\nexport async function generate() { return generateSummary(); }\n',
    [`${S}/features/summary/chat.tsx`]: '"use client";\nimport type { model } from "@/lib/ai";\nexport function Chat() { return null; }\n',
    [`${S}/app/api/route.ts`]: 'import { generateSummary } from "../../lib/ai";\nexport async function POST() { return Response.json(await generateSummary()); }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/app/dynamic/page.tsx`, `${S}/app/page.tsx`, `${S}/features/summary/summary.server.ts`, `${S}/lib/other.ts`]);
  assert.equal(diagnostics.find(({ filename }) => filename === `${S}/app/page.tsx`).message, "Call generateSummary only from a \"use server\" file or a route handler and store the result, so render reads what was stored and never generates.");
});

test("ai-render resolves package imports and aliases to src/lib/ai", (t) => {
  const diagnostics = lint(t, "ai-render", {
    "apps/web/package.json": { dependencies: { next: "16", react: "19" }, imports: { "#ai": "./src/lib/ai.ts", "#gen": "./src/lib/generate.ts" } },
    [`${S}/lib/ai.ts`]: "export async function generateSummary() { return 1; }\n",
    [`${S}/lib/generate.ts`]: "export const other = 1;\n",
    [`${S}/app/page.tsx`]: 'import { generateSummary } from "#ai";\nexport default async function Page() { return <p>{await generateSummary()}</p>; }\n',
    [`${S}/app/other/page.tsx`]: 'import { other } from "#gen";\nexport default function Page() { return <p>{other}</p>; }\n',
    [`${S}/app/lazy/page.tsx`]: 'export default async function Page() { const { generateSummary } = await import(`#ai`); return <p>{await generateSummary()}</p>; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/app/lazy/page.tsx`, `${S}/app/page.tsx`]);
});

test("ai-render applies only inside Next apps", (t) => {
  const diagnostics = lint(t, "ai-render", {
    "apps/api/package.json": { type: "module", dependencies: { hono: "4" } },
    "apps/api/src/lib/ai.ts": "export function createProvider() { return 1; }\n",
    "apps/api/src/ai/model-runtime/driver.ts": 'import { createProvider } from "../../lib/ai.js";\nexport const driver = createProvider();\n',
    [`${S}/lib/ai.ts`]: "export async function generateSummary() { return 1; }\n",
    [`${S}/app/page.tsx`]: 'import { generateSummary } from "@/lib/ai";\nexport default async function Page() { return <p>{await generateSummary()}</p>; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/app/page.tsx`]);
});
