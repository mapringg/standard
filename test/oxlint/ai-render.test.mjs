import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("Server Components and use cache functions import no AI generation module", (t) => {
  const diagnostics = lint(t, "ai-render", {
    [`${S}/lib/ai.ts`]: "export async function generateSummary() { return 1; }\nexport const model = 1;\n",
    [`${S}/features/summary/generate.ts`]: 'export { generateSummary as summarize } from "@/lib/ai";\n',
    [`${S}/features/summary/again.ts`]: 'import { summarize } from "./generate";\nexport { summarize };\n',
    [`${S}/features/summary/format.ts`]: "export const format = String;\n",
    [`${S}/app/page.tsx`]: 'import { generateSummary } from "@/lib/ai";\nexport default async function Page() { return <p>{await generateSummary()}</p>; }\n',
    [`${S}/app/re-export/page.tsx`]: 'import { summarize } from "../../features/summary/again";\nimport { format } from "../../features/summary/format";\nexport default async function Page() { return <p>{format(await summarize())}</p>; }\n',
    [`${S}/app/dynamic/page.tsx`]: 'export default async function Page() { const { model } = await import("@/lib/ai"); return <p>{model}</p>; }\n',
    [`${S}/features/summary/summary.server.ts`]: 'import { generateSummary } from "@/lib/ai";\nexport async function cached() { "use cache"; return generateSummary(); }\n',
    [`${S}/features/summary/summary.actions.ts`]: '"use server";\nimport { generateSummary } from "@/lib/ai";\nexport async function generate() { return generateSummary(); }\n',
    [`${S}/features/summary/chat.tsx`]: '"use client";\nimport type { model } from "@/lib/ai";\nexport function Chat() { return null; }\n',
    [`${S}/app/api/route.ts`]: 'import { generateSummary } from "@/lib/ai";\nexport async function POST() { return Response.json(await generateSummary()); }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/app/dynamic/page.tsx`, `${S}/app/page.tsx`, `${S}/app/re-export/page.tsx`, `${S}/features/summary/summary.server.ts`]);
  assert.equal(diagnostics.find(({ filename }) => filename === `${S}/app/page.tsx`).message, "Call generateSummary from a Server Action or route handler and store the result, so render reads what was stored and never generates.");
});
