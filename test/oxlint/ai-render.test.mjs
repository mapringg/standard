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
