import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const RULES = new Set(["react(no-unstable-nested-components)", "react(incompatible-library)"]);

test("render props and third-party hooks pass and components defined in render still fail", (t) => {
  const result = lint(t, {
    "apps/web/src/features/task/task-gallery.tsx": [
      'import { useWindowVirtualizer } from "@tanstack/react-virtual";',
      "",
      'import { Lightbox } from "#/components/ui/lightbox.tsx";',
      'import { Panel } from "#/components/ui/panel.tsx";',
      "",
      "export function TaskGallery() {",
      "  const rows = useWindowVirtualizer({ count: 10, estimateSize: () => 10 });",
      "  return <Lightbox size={rows.getTotalSize()} aside={(item: string) => <Panel item={item} />} />;",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/features/task/task-list.tsx": [
      "export function TaskList() {",
      "  function Row() {",
      "    return <li />;",
      "  }",
      "  return <Row />;",
      "}",
      "",
    ].join("\n"),
  });
  deepEqual(
    result.filter((item) => RULES.has(item.rule)).map((item) => `${item.file} ${item.rule}`),
    ["apps/web/src/features/task/task-list.tsx react(no-unstable-nested-components)"],
  );
});
