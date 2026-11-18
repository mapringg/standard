import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const code = "export const a = 1;\n";
const base = {
  "apps/web/src/app/(app)/page.tsx": code,
  "apps/web/src/app/(app)/error.tsx": code,
  "apps/web/src/lib/log.ts": code,
  "apps/api/src/app.ts": code,
  "apps/api/src/lib/log.ts": code,
};

function findings(t, files) {
  return only(lint(t, { ...base, ...files }), "repo-shape")
    .map((item) => `${item.file} | ${item.message}`)
    .sort();
}

test("repo-shape accepts the standard layout", (t) => {
  deepEqual(
    findings(t, {
      "README.md": "x",
      "AGENTS.md": "x",
      "apps/web/README.md": "x",
      ".claude/skills/verify/SKILL.md": "x",
      "apps/web/src/app/globals.css": "x",
      "apps/web/next.config.ts": code,
      "apps/web/src/features/task/task-list.tsx": code,
      "apps/web/src/features/task/task-list.test.tsx": code,
      "apps/web/src/components/ui/button.tsx": code,
      "apps/api/src/features/tasks/routes.ts": code,
      "apps/api/src/features/tasks/routes.test.ts": code,
      "apps/api/src/upstreams/line.ts": code,
      "apps/web/src/lib/i18n/messages/task.ts": code,
      "apps/marketing/src/pages/[locale]/index.astro": "x",
      "apps/marketing/src/lib/log.ts": code,
      "apps/web/.gitignore": "/generated\n*.local.ts\n",
      "apps/web/generated/schema.ts": code,
      "apps/web/src/lib/env.local.ts": code,
    }),
    [],
  );
});

test("repo-shape flags stray files, docs, styles and folders", (t) => {
  deepEqual(
    findings(t, {
      "docs/guide.md": "x",
      "CLAUDE.md": "x",
      "apps/web/src/app/globals.css": "x",
      "apps/web/src/components/ui/extra.css": "x",
      "apps/web/src/app/(app)/x.module.css": "x",
      "apps/web/src/app/(app)/loading.tsx": code,
      "apps/web/src/app/(app)/@modal/page.tsx": code,
      "apps/web/src/app/(app)/_parts/page.tsx": code,
      "apps/web/src/app/(app)/hook/route.ts": code,
      "apps/web/src/app/(app)/page.test.tsx": code,
      "apps/web/src/app/(admin)/page.tsx": code,
      "apps/web/src/features/task/list/task-list.tsx": code,
      "apps/web/src/features/task/board.tsx": code,
      "apps/web/src/lib/format.ts": code,
      "apps/web/src/lib/format.test.ts": code,
      "apps/web/src/lib/format.browser.test.ts": code,
      "apps/web/src/lib/orphan.test.ts": code,
      "apps/web/scripts/seed.ts": code,
      "apps/api/src/features/tasks/helpers.ts": code,
      "apps/admin/src/app.ts": code,
      "apps/liff/src/lib/log.ts": code,
      "packages/i18n/src/skip.ts": "// oxlint-disable\nexport const a = 1;\n",
      "apps/web/src/lib/log.spec.ts": code,
      "apps/web/src/features/task/messages/task.ts": code,
      "apps/marketing/src/pages/about.astro": "x",
      "apps/marketing/src/lib/log.ts": code,
    }),
    [
      "apps/marketing/src/lib/log.ts | apps/marketing/src/pages/about.astro: Marketing pages live under src/pages/[locale]/.",
      "apps/web/src/features/task/messages/task.ts | Dictionaries live only in src/lib/i18n/messages/<feature>.ts.",
      "apps/web/src/features/task/messages/task.ts | Feature folders hold files only, no subfolders. Split a big feature into two features.",
      "apps/web/src/lib/log.spec.ts | Name tests *.test.ts or *.test.tsx.",
      "apps/admin/src/app.ts | Apps are api, web, liff, marketing, mobile.",
      "apps/admin/src/app.ts | CLAUDE.md: Markdown is only README.md and AGENTS.md, one each per repo and per app. Put the rest in one of them or delete it.",
      "apps/admin/src/app.ts | docs/guide.md: The top level holds only apps/, packages/ and config files.",
      "apps/admin/src/app.ts | packages/i18n/src/skip.ts: Remove the oxlint/eslint disable directive. Fix the code or change the standard.",
      "apps/api/src/features/tasks/helpers.ts | API feature files are routes.ts, schema.ts, db.ts and service.ts.",
      "apps/liff/src/lib/log.ts | apps/liff: Every UI app has src/app/.",
      "apps/web/scripts/seed.ts | Code lives in src/.",
      "apps/web/src/app/(admin)/page.tsx | apps/web/src/app/(admin): Each route group has an error.tsx with retry.",
      "apps/web/src/app/(app)/@modal/page.tsx | No parallel routes. Compose the sections inside one page.",
      "apps/web/src/app/(app)/@modal/page.tsx | apps/web/src/app/(app)/x.module.css: No CSS modules. Use Tailwind classes.",
      "apps/web/src/app/(admin)/page.tsx | apps/web/src/components/ui/extra.css: One global CSS file per app or package; apps/web/src/app/globals.css is the global.",
      "apps/web/src/app/(app)/_parts/page.tsx | No _private folders in app/. Move the code into a feature or components/.",
      "apps/web/src/app/(app)/hook/route.ts | route.ts serves only webhooks (under a webhooks/ folder) and metadata files like sitemap.xml/route.ts.",
      "apps/web/src/app/(app)/loading.tsx | No loading.tsx. Wrap the slow section in <Section fallback> from components/boundary/section.tsx.",
      "apps/web/src/app/(app)/page.test.tsx | Route files never have tests. Test the feature code instead.",
      "apps/web/src/app/(app)/page.test.tsx | app/ holds only Next route files. Move this code into a feature or components/.",
      "apps/web/src/features/task/board.tsx | Prefix the file with its feature: task-board.",
      "apps/web/src/features/task/list/task-list.tsx | Feature folders hold files only, no subfolders. Split a big feature into two features.",
      "apps/web/src/lib/format.test.ts | One test file per source file. Merge into apps/web/src/lib/format.browser.test.ts.",
      "apps/web/src/lib/orphan.test.ts | Tests sit next to the code they test. Name the file after its source: orphan.ts needs to exist.",
    ].sort(),
  );
});
