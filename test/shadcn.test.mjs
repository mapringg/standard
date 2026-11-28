import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const BUTTON = `import { cva } from "class-variance-authority";

const button = cva("rounded px-3", { variants: { size: { sm: "px-2", lg: "px-4" } } });

export const Button = (props: { size?: "sm" | "lg"; className?: string }) => (
  <button type="button" className={button({ size: props.size }) + (props.className ?? "")} />
);
`;

test("shadcn rules check pages and leave component internals alone", (t) => {
  const result = lint(t, {
    "apps/web/src/components/ui/button.tsx": BUTTON,
    "apps/web/src/features/task/task-view.tsx": `import { Button } from "#/components/ui/button.tsx";

export const TaskView = () => (
  <section className="p-[13px]" style={{ width: 10 }}>
    <Button className="mt-2 p-4" />
  </section>
);
`,
  });
  deepEqual(
    result
      .filter((item) => item.rule.startsWith("shadcn("))
      .map((item) => `${item.file} | ${item.rule}`)
      .sort(),
    [
      "apps/web/src/features/task/task-view.tsx | shadcn(no-arbitrary-values)",
      "apps/web/src/features/task/task-view.tsx | shadcn(no-inline-styles)",
      "apps/web/src/features/task/task-view.tsx | shadcn(no-restyle)",
    ],
  );
});
