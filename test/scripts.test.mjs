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

test("explicit CommonJS tools can load through Node's legacy preload interface", (t) => {
  const preload = 'const { sep } = require("node:path");\nmodule.exports = { sep };\n';
  const production = "apps/api/src/lib/path.cjs";
  const esModule = "scripts/preload.mjs";
  const blocked = /^(?:import\((?:no-commonjs|unambiguous)\)|typescript\((?:no-require-imports|no-var-requires)\))$/;
  const actual = lint(t, {
    "scripts/preload.cjs": preload,
    ".claude/skills/verify/scripts/preload.cjs": preload,
    [esModule]: preload,
    [production]: preload,
  });
  const files = new Set(actual.filter(({ rule }) => blocked.test(rule)).map(({ file }) => file));
  deepEqual([...files].sort(), [production, esModule].sort());
});
