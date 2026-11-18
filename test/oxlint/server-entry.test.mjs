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
  assert.equal(diagnostics[0].message, "Keep ./index.server out of this file, which ships to the browser: a *.server.* file is server-only. Import the module's index entry, or move the import to server code.");
});

test("server-entry resolves every import a browser file makes and flags any *.server.* file", (t) => {
  const diagnostics = lint(t, "server-entry", {
    "apps/web/package.json": { dependencies: { next: "16", react: "19" }, imports: { "#report": "./src/features/report/index.server.ts" } },
    [`${S}/features/report/index.server.ts`]: 'export { load } from "./load.server";\n',
    [`${S}/features/report/load.server.ts`]: 'export const load = 1;\n',
    [`${S}/features/report/data.ts`]: 'export * from "./load.server";\n',
    [`${S}/features/report/index.ts`]: 'export * from "./data";\n',
    [`${S}/features/report/alias.tsx`]: '"use client";\nimport { load } from "#report";\nexport const A = () => load;\n',
    [`${S}/features/report/template.tsx`]: '"use client";\nexport const T = () => import(`./load.server`);\n',
    [`${S}/features/report/required.tsx`]: '"use client";\nconst { load } = require("./load.server");\nexport const R = () => load;\n',
    [`${S}/features/report/direct.tsx`]: '"use client";\nimport { load } from "./load.server";\nexport const D = () => load;\n',
    [`${S}/features/report/chain.tsx`]: '"use client";\nimport { load } from ".";\nexport const C = () => load;\n',
    [`${S}/features/report/lazy.tsx`]: '"use client";\nexport const L = () => import(`./lazy-target`);\n',
    [`${S}/features/report/lazy-target.ts`]: 'import { load } from "./load.server";\nexport const target = load;\n',
    [`${S}/app/page.tsx`]: 'import { load } from "#report";\nimport { view } from "@/features/report/load.server";\nexport default function Page() { return [load, view]; }\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [`${S}/features/report/alias.tsx`, `${S}/features/report/data.ts`, `${S}/features/report/direct.tsx`, `${S}/features/report/lazy-target.ts`, `${S}/features/report/required.tsx`, `${S}/features/report/template.tsx`]);
});
