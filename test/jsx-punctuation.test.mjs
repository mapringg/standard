import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const RULES = new Set(["react(jsx-no-literals)", "react(jsx-curly-brace-presence)"]);

test("punctuation is plain JSX text and words still need a message", (t) => {
  const result = lint(t, {
    "apps/web/src/components/ui/range.tsx": [
      "export function Range(props: { from: number; to: number }) {",
      "  return (",
      "    <p>",
      "      {props.from}",
      "      <span>-</span>",
      "      <span>–</span>",
      "      <span>/</span>",
      "      <span>·</span>",
      "      {props.to}",
      "    </p>",
      "  );",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/components/ui/braced.tsx": 'export function Braced() {\n  return <span>{"-"}</span>;\n}\n',
    "apps/web/src/components/ui/word.tsx": "export function Word() {\n  return <span>Hello</span>;\n}\n",
  });
  deepEqual(
    result
      .filter((item) => RULES.has(item.rule))
      .map((item) => `${item.file} ${item.rule}`)
      .sort(),
    [
      "apps/web/src/components/ui/braced.tsx react(jsx-curly-brace-presence)",
      "apps/web/src/components/ui/word.tsx react(jsx-no-literals)",
    ],
  );
});

test("a decorative image takes an empty alt and a real alt still needs a message", (t) => {
  const result = lint(t, {
    "apps/web/src/components/ui/divider.tsx":
      'export function Divider() {\n  return <img src="/line.svg" alt="" />;\n}\n',
    "apps/web/src/components/ui/logo.tsx":
      'export function Logo() {\n  return <img src="/logo.svg" alt="Logo" />;\n}\n',
  });
  deepEqual(
    result.filter((item) => item.rule === "react(jsx-no-literals)").map((item) => item.file),
    ["apps/web/src/components/ui/logo.tsx"],
  );
});
