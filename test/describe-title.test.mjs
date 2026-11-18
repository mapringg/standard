import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

test("describe may name an imported value that is not a function", (t) => {
  const result = lint(t, {
    "apps/web/src/lib/query-parameter.ts": 'import { z } from "zod";\n\nexport const textParam = z.string();\n',
    "apps/web/src/lib/query-parameter.test.ts": [
      'import { describe, expect, test } from "vitest";',
      "",
      'import { textParam } from "#/lib/query-parameter.ts";',
      "",
      'describe("textParam", () => {',
      '  test("parses text", () => {',
      '    expect(textParam.parse("a")).toBe("a");',
      "  });",
      "});",
      "",
    ].join("\n"),
  });
  deepEqual(
    result.filter((item) => item.rule === "vitest(prefer-describe-function-title)"),
    [],
  );
});
