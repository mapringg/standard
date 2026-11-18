import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { filesWith, lint } from "./lint.mjs";

test("style-prop allows only CSS custom properties", (t) => {
  const result = lint(t, {
    "apps/web/src/components/ui/bar.tsx":
      'export const Bar = (props: { value: string }) => <div className="w-(--progress)" style={{ "--progress": props.value }} />;\n',
    "apps/web/src/components/ui/box.tsx": "export const Box = () => <div style={{ width: 10 }} />;\n",
    "apps/web/src/components/ui/mixed.tsx":
      'export const Mixed = (props: { value: string }) => <div style={{ "--a": props.value, color: "red" }} />;\n',
    "apps/web/src/components/ui/spread.tsx": "export const Spread = (props: object) => <div style={props} />;\n",
  });
  deepEqual(filesWith(result, "style-prop"), [
    "apps/web/src/components/ui/box.tsx",
    "apps/web/src/components/ui/mixed.tsx",
    "apps/web/src/components/ui/spread.tsx",
  ]);
});
