import assert from "node:assert/strict";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

test("banned and client-data accept the role a file name carries", (t) => {
  const cwd = tempRepo(t, {});
  write(cwd, {
    "apps/web/package.json": { dependencies: { next: "16.0.0", react: "19.0.0" } },
    "apps/web/src/lib/swr.ts": 'import useSWRBase from "swr";\nexport function useSWR() {\n  return useSWRBase();\n}\n',
    "apps/web/src/map.effect-sync.browser.ts": 'import { useEffect } from "react";\nexport function useMap() {\n  useEffect(() => {}, []);\n}\n',
    "apps/web/src/pages.data-pages.tsx": 'import { useSWR } from "./lib/swr";\nexport function usePages() {\n  return useSWR();\n}\n',
  });
  git(cwd, "add", "-A");
  for (const check of ["banned", "client-data"]) {
    const run = standard(cwd, ["check", check]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
});

test("the legacy lists print their own deprecation notice", (t) => {
  const cwd = tempRepo(t, { "effect-wrappers": [{ file: "src/a.ts", reason: "Binds the map." }] });
  write(cwd, { "src/a.ts": "export const a = 1;\n" });
  git(cwd, "add", "-A");
  const run = standard(cwd, ["check", "banned"]);
  assert.ok(run.listsNotice, run.stderr);
});
