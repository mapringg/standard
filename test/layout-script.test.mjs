import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const script = [
  'const BOOT = "document.documentElement.dataset.ready = \\"true\\";";',
  "",
  "export default function Layout({ children }: { children: React.ReactNode }) {",
  "  return (",
  '    <html lang="en">',
  "      <head>",
  "        <script dangerouslySetInnerHTML={{ __html: BOOT }} />",
  "      </head>",
  "      <body>{children}</body>",
  "    </html>",
  "  );",
  "}",
  "",
].join("\n");

test("a root layout may inline a boot script and other components may not", (t) => {
  const result = lint(t, {
    "apps/web/src/app/[lang]/layout.tsx": script,
    "apps/web/src/components/ui/boot.tsx": script.replace("export default function Layout", "export function Boot"),
  });
  deepEqual(
    result.filter((item) => item.rule === "react(no-danger)").map((item) => item.file),
    ["apps/web/src/components/ui/boot.tsx"],
  );
});
