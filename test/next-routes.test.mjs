import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("next-routes keeps pages and layouts synchronous with typed props", (t) => {
  const result = lint(t, {
    "apps/web/src/app/(app)/tasks/page.tsx":
      'export default function Page(props: PageProps<"/tasks">) { return props.params; }\n',
    "apps/web/src/app/(app)/layout.tsx":
      'export default function Layout({ children }: LayoutProps<"/">) { return children; }\n',
    "apps/web/src/app/(app)/async/page.tsx": "export default async function Page() { return null; }\n",
    "apps/web/src/app/(app)/untyped/page.tsx":
      "export default function Page(props: { id: string }) { return props.id; }\n",
    "apps/web/src/app/(app)/top/page.tsx":
      "const data = await Promise.resolve(1);\nexport default function Page() { return data; }\n",
    "apps/web/src/app/(app)/error.tsx": "export default function Error() { return null; }\n",
  });
  deepEqual(filesWith(result, "next-routes"), [
    "apps/web/src/app/(app)/async/page.tsx",
    "apps/web/src/app/(app)/top/page.tsx",
    "apps/web/src/app/(app)/untyped/page.tsx",
  ]);
});
