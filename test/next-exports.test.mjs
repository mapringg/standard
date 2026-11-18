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
        "export const unstable_dynamicStaleTime = 30;",
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

const own = (result, files) =>
  result
    .filter((item) => files.includes(item.file) && !item.rule.startsWith("typescript("))
    .map((item) => `${item.file} ${item.rule}`);

test("Next image metadata and sitemap files export their config beside the default export", (t) => {
  const image = (exports) =>
    [
      'import { ImageResponse } from "next/og";',
      "",
      ...exports,
      "export default function Image() {",
      "  return new ImageResponse(<div />);",
      "}",
      "",
    ].join("\n");
  const files = {
    "apps/web/src/app/opengraph-image.tsx": image([
      'export const alt = "Preview";',
      "export const size = { width: 1200, height: 630 };",
      'export const contentType = "image/png";',
    ]),
    "apps/web/src/app/tasks/twitter-image.tsx": image([
      'export const alt = "Preview";',
      "export const size = { width: 1200, height: 630 };",
      'export const contentType = "image/png";',
      'export const runtime = "nodejs";',
    ]),
    "apps/web/src/app/icon.tsx": image([
      'export const generateImageMetadata = () => [{ id: "small", size: { width: 48, height: 48 } }];',
    ]),
    "apps/web/src/app/apple-icon.tsx": image([
      "export const size = { width: 180, height: 180 };",
      'export const contentType = "image/png";',
    ]),
    "apps/web/src/app/sitemap.ts": [
      "export const generateSitemaps = () => [{ id: 0 }];",
      "export default function sitemap() {",
      '  return [{ url: "https://example.com" }];',
      "}",
      "",
    ].join("\n"),
  };
  const result = lint(t, { ...files, "apps/web/src/lib/log.ts": "export const a = 1;\n" });
  deepEqual(own(result, Object.keys(files)), []);
});

test("Next proxy and middleware config stays a plain string Next can read", (t) => {
  const config = 'export const config = { matcher: ["/((?!api|_next\\\\/static).*)"] };\n';
  const files = {
    "apps/web/src/proxy.ts": config,
    "apps/web/src/middleware.ts": config,
    "apps/web/src/lib/paths.ts": 'export const pattern = "_next\\\\/static";\n',
  };
  deepEqual(
    lint(t, files)
      .filter((item) => item.rule === "unicorn(prefer-string-raw)")
      .map((item) => item.file),
    ["apps/web/src/lib/paths.ts"],
  );
});
