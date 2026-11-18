import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const code = "export const a = 1;\n";
const astro =
  "---\nconst { title } = Astro.props;\n---\n<section><h1>{title}</h1><script>const a = 1;</script></section>\n";
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
      "apps/api/src/upstreams/line.test.ts": code,
      "apps/api/src/infra/queue.ts": code,
      "apps/api/src/infra/queue.test.ts": code,
      "apps/api/src/middleware/auth.ts": code,
      "apps/api/src/middleware/auth.test.ts": code,
      "apps/api/src/env.ts": code,
      "apps/api/src/env.test.ts": code,
      "apps/api/src/server.ts": code,
      "apps/api/src/client.ts": code,
      "apps/api/src/features/jobs/routes.ts": code,
      "apps/email/package.json": JSON.stringify({ dependencies: { hono: "1.0.0" } }),
      "apps/email/src/app.ts": code,
      "apps/email/src/lib/log.ts": code,
      "apps/web/src/features/notes/notes.server.ts": code,
      "apps/web/src/features/notes/notes-list.fixture.ts": code,
      "apps/web/src/features/notes/notes-list.test-utils.ts": code,
      "apps/web/src/features/notes/notes-list.tsx": code,
      "apps/web/e2e/notes.test.ts": code,
      "apps/web/src/lib/i18n/messages/task.ts": code,
      "apps/web/src/app/(app)/chats/[chatId]/messages/page.tsx": code,
      "apps/web/src/app/webhooks/i18n/route.ts": code,
      "apps/marketing/src/pages/index.astro": astro,
      "apps/marketing/src/components/hero/hero.astro": astro,
      "infra/k8s/web.yaml": "x",
      "scripts/deploy.ts": code,
      "apps/api/migrations/0001-init.ts": code,
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
      "apps/api/src/routes/tasks.test.ts": code,
      "apps/admin/src/app.ts": code,
      "apps/liff/src/lib/log.ts": code,
      "packages/i18n/src/skip.ts": "// oxlint-disable\nexport const a = 1;\n",
      "apps/web/src/lib/log.spec.ts": code,
      "apps/web/src/features/task/messages/task.ts": code,
      "apps/marketing/src/pages/about.astro": "x",
      "apps/marketing/src/lib/log.ts": code,
      "apps/marketing/src/pages/[locale]/index.astro": astro,
      "apps/marketing/src/lib/seo.astro": astro,
      "apps/web/src/components/ui/card.astro": astro,
      "scripts/check-links.ts": code,
      "apps/web/src/features/task/task-helpers.ts": code,
      "apps/web/src/lib/mocks.ts": code,
      "apps/web/e2e/deep/flow.test.ts": code,
    }),
    [
      "apps/admin/src/app.ts | CLAUDE.md: Fold this into README.md or AGENTS.md, or delete it.",
      "apps/admin/src/app.ts | Add hono, next, vite, expo or astro to the app's package.json dependencies so the standard knows its kind.",
      "apps/admin/src/app.ts | docs/guide.md: Move this into apps/ or packages/; the top level holds only config.",
      "apps/admin/src/app.ts | packages/i18n/src/skip.ts: Delete the disable directive and fix the code, or change the standard.",
      "apps/api/src/features/tasks/helpers.ts | Move the code into the feature's routes.ts, schema.ts, db.ts or service.ts.",
      "apps/api/src/features/tasks/helpers.ts | Rename the file to <name>.fixture.ts or <name>.test-utils.ts.",
      "apps/api/src/routes/tasks.test.ts | Move the code into app.ts, factory.ts, env.ts, server.ts, client.ts, middleware/, lib/, infra/, upstreams/ or features/<resource>/.",
      "apps/api/src/routes/tasks.test.ts | Move the test next to the code it tests in features/, lib/, middleware/, infra/, upstreams/ or beside app.ts, factory.ts, env.ts, server.ts or client.ts.",
      "apps/api/src/routes/tasks.test.ts | Name the test after the source file next to it; tasks.ts does not exist.",
      "apps/liff/src/lib/log.ts | apps/liff: Add src/app/.",
      "apps/marketing/src/lib/log.ts | apps/marketing/src/pages/about.astro: Move the page under src/pages/[locale]/.",
      "apps/web/e2e/deep/flow.test.ts | Move the journey to apps/<app>/e2e/<journey>.test.ts.",
      "apps/web/scripts/seed.ts | Move the code into src/.",
      "apps/web/src/app/(admin)/page.tsx | apps/web/src/app/(admin): Add an error.tsx with retry to the route group.",
      "apps/web/src/app/(admin)/page.tsx | apps/web/src/components/ui/extra.css: Move these styles into apps/web/src/app/globals.css, the one global CSS file.",
      "apps/web/src/app/(app)/@modal/page.tsx | Compose the sections inside one page instead of a parallel route.",
      "apps/web/src/app/(app)/@modal/page.tsx | apps/web/src/app/(app)/x.module.css: Replace the CSS module with Tailwind classes.",
      "apps/web/src/app/(app)/_parts/page.tsx | Move the code from the _private folder into a feature or components/.",
      "apps/web/src/app/(app)/hook/route.ts | Move the handler into a webhooks/ folder or a metadata route like sitemap.xml/route.ts, or into a Server Action.",
      "apps/web/src/app/(app)/loading.tsx | Delete loading.tsx and wrap the slow section in <Section fallback> from #/components/boundary/section.",
      "apps/web/src/app/(app)/page.test.tsx | Move the test to the feature code it covers; route files never have tests.",
      "apps/web/src/app/(app)/page.test.tsx | Move this code into a feature or components/; app/ holds only Next route files.",
      "apps/web/src/features/task/board.tsx | Rename the file to task-board so it starts with its feature.",
      "apps/web/src/features/task/list/task-list.tsx | Flatten the feature folder, or split a big feature into two features.",
      "apps/web/src/features/task/messages/task.ts | Flatten the feature folder, or split a big feature into two features.",
      "apps/web/src/features/task/messages/task.ts | Move the dictionary to src/lib/i18n/messages/<feature>.ts.",
      "apps/web/src/features/task/task-helpers.ts | Rename the file to <name>.fixture.ts or <name>.test-utils.ts.",
      "apps/web/src/lib/format.test.ts | Merge this test into apps/web/src/lib/format.browser.test.ts, the one test file for its source.",
      "apps/web/src/lib/log.spec.ts | Rename the test to *.test.ts or *.test.tsx.",
      "apps/web/src/lib/mocks.ts | Rename the file to <name>.fixture.ts or <name>.test-utils.ts.",
      "apps/web/src/lib/orphan.test.ts | Name the test after the source file next to it; orphan.ts does not exist.",
      "apps/marketing/src/lib/log.ts | apps/marketing/src/lib/seo.astro: Write this component as .tsx; .astro files live only in the marketing app's routes and components.",
      "apps/marketing/src/lib/log.ts | apps/marketing/src/pages/about.astro: Move the text into a content collection entry or pass it as a prop.",
      "apps/web/src/app/(admin)/page.tsx | apps/web/src/components/ui/card.astro: Write this component as .tsx; .astro files live only in the marketing app's routes and components.",
      "scripts/check-links.ts | Delete the check script and add the check to the standard; scripts/ holds operational tools.",
    ].sort(),
  );
});
