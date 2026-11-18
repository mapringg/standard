import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("code that ships to the browser imports no index.server entry", (t) => {
  const diagnostics = lint(t, "server-entry", {
    [`${S}/features/report/index.server.ts`]: 'export const load = 1;\n',
    [`${S}/features/report/view.tsx`]: '"use client";\nimport { load } from "@/features/report/index.server";\nexport const View = () => load;\n',
    [`${S}/features/report/shared.ts`]: 'import { load } from "./index.server";\nexport const shared = load;\n',
    [`${S}/features/report/panel.tsx`]: '"use client";\nimport { shared } from "./shared";\nimport type { Load } from "./index.server";\nexport const Panel = () => shared;\n',
    [`${S}/app/page.tsx`]: 'import { load } from "@/features/report/index.server";\nexport default function Page() { return load; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/features/report/shared.ts`, `${S}/features/report/view.tsx`]);
  assert.equal(diagnostics[0].message, "Import this module's index entry here; its index.server entry is server-only, and this file ships to the browser.");
});
