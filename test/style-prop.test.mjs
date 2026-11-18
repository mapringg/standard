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
    "apps/web/src/components/ui/card.tsx":
      'import { Bar } from "@/components/ui/bar";\nexport const Card = () => <Bar className="p-2" value="1" />;\n',
    "apps/web/src/components/ui/cast.tsx":
      'import type { CSSProperties } from "react";\nexport const Cast = (props: { value: string }) => <div style={{ "--progress": props.value } as CSSProperties} />;\n',
    "apps/web/src/components/ui/pinned.tsx":
      'import type { CSSProperties } from "react";\nexport const Pinned = (props: { value: string }) => <div style={{ "--progress": props.value } satisfies CSSProperties} />;\n',
    "apps/web/src/components/ui/cast-width.tsx":
      'import type { CSSProperties } from "react";\nexport const CastWidth = () => <div style={{ width: 10 } as CSSProperties} />;\n',
    "apps/web/src/components/ui/spread.tsx": "export const Spread = (props: object) => <div style={props} />;\n",
  });
  deepEqual(
    result.filter((item) => /forbid/.test(item.rule)),
    [],
  );
  deepEqual(filesWith(result, "style-prop"), [
    "apps/web/src/components/ui/box.tsx",
    "apps/web/src/components/ui/cast-width.tsx",
    "apps/web/src/components/ui/mixed.tsx",
    "apps/web/src/components/ui/spread.tsx",
  ]);
});
