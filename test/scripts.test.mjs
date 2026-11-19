import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint } from "./lint.mjs";

const tool =
  'import { readFileSync } from "node:fs";\n\nconst data = JSON.parse(readFileSync("x.json", "utf8"));\nexport const name = typeof data === "object" ? data.a : null;\nexport async function steps(run) {\n  for (const step of ["down", "up"]) await run(step);\n}\n';
const relaxed =
  /^(?:typescript|eslint\(no-await-in-loop\)|node\(no-sync\)|import\(no-nodejs-modules\)|standard\(no-typeof\))/;

test("scripts and skills lint as plain JS tools that may use Node", (t) => {
  const result = lint(t, {
    "scripts/tool.mjs": tool,
    ".claude/skills/verify/scripts/tool.mjs": tool,
    "apps/api/src/lib/read.ts":
      'import { readFile } from "node:fs/promises";\n\nexport const read = async (path: string) => readFile(path, "utf8");\n',
  });
  deepEqual(
    result.filter(
      (item) =>
        (item.file.includes("scripts/") && relaxed.test(item.rule)) || item.rule === "import(no-nodejs-modules)",
    ),
    [],
  );
});
