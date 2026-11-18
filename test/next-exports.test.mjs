import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const page = (exports) => `${exports}\nexport default function Page() {\n  return <main />;\n}\n`;

test("Next route segment config and metadata exports sit beside the page component", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-metadata.ts": "export const generateMetadata = () => ({ title: 'Task' });\n",
    "apps/web/src/app/page.tsx": page(
      [
        "export const instant = true;",
        "export const prefetch = 'partial';",
        "export const ensureStatic = 'navigation';",
        "export const revalidate = 60;",
        "export const dynamic = 'force-dynamic';",
        "export const dynamicParams = true;",
        "export const fetchCache = 'auto';",
        "export const runtime = 'nodejs';",
        "export const preferredRegion = 'auto';",
        "export const maxDuration = 5;",
        "export const experimental_ppr = true;",
        "export const metadata = { title: 'Home' };",
        "export const viewport = { themeColor: 'black' };",
        "export const generateViewport = () => ({ themeColor: 'black' });",
        "export const generateStaticParams = () => [];",
      ].join("\n"),
    ),
    "apps/web/src/app/tasks/layout.tsx": [
      'export { generateMetadata } from "#/features/task/task-metadata";',
      "export default function Layout(props: { children: React.ReactNode }) {",
      "  return <section>{props.children}</section>;",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/app/about/page.tsx": [
      'export { generateMetadata as generateMetadata } from "#/features/task/task-metadata";',
      "export default function Page() {",
      "  return <main />;",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/app/other/page.tsx": page("export const helper = 1;"),
    "apps/web/src/features/task/task-view.tsx": "export const metadata = 1;\nexport const TaskView = () => <div />;\n",
  });
  deepEqual(
    [
      ...new Set(result.filter((item) => item.rule === "react(only-export-components)").map((item) => item.file)),
    ].sort(),
    ["apps/web/src/app/other/page.tsx", "apps/web/src/features/task/task-view.tsx"],
  );
});
