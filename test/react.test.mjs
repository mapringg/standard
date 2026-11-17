import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const NEXT_APP = { "apps/web/package.json": { dependencies: { next: "16.0.0", react: "19.0.0" } } };
const STATE_FIX = "Hold its state in one useReducer whose state is a union with a status field.";
const FLAG_FIX = 'Model the request as a status in a useReducer state union, such as { status: "loading" } | { status: "done", data }.';
const FETCH_FIX = "Fetch in a server component, or through useServerData or useServerDataPages from src/lib/swr.ts when the data needs pagination or revalidation.";
const NO_BASELINE = "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.";
const UNION_FIX = 'Make the state a union with one member per status, such as { status: "idle" } | { status: "done", items: Item[] }.';
const SWR_FIX = "Use useServerData or useServerDataPages from src/lib/swr.ts of its app, copied from node_modules/@mapringg/standard/templates/swr.ts with the exports it does not use deleted.";

function react(t, files, ...flags) {
  const cwd = tempRepo(t);
  write(cwd, { ...NEXT_APP, ...files });
  git(cwd, "add", "-A");
  return { cwd, ...standard(cwd, ["check", "react", ...flags]) };
}

function fails(t, files, ...fixes) {
  const { stdout, stderr, status } = react(t, files);
  assert.equal(stderr, "");
  assert.equal(stdout, [`react: ${fixes.length} new findings.`, ...fixes.map((fix) => `  ${fix}`), NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
}

function passes(t, files) {
  const { stdout, stderr, status } = react(t, files);
  assert.deepEqual({ stdout, stderr, status }, { stdout: "react: OK\n", stderr: "", status: 0 });
}

test("react fails a second useState in a component or a hook, through memo and a namespace import", (t) => {
  fails(
    t,
    {
      "apps/web/src/form.tsx": [
        'import { useEffect, useState } from "react";',
        "export function Form() {",
        '  const [name, setName] = useState("");',
        "  const [age, setAge] = useState(0);",
        "  useEffect(() => setName(String(age)));",
        "  const [tags] = useState([]);",
        "  return [name, setAge, tags];",
        "}",
        "",
      ].join("\n"),
      "apps/web/src/use-pager.ts": 'import * as React from "react";\nexport const usePager = () => {\n  const [page] = React.useState(1);\n  const [size] = React.useState(10);\n  return page * size;\n};\n',
      "apps/web/src/card.tsx": 'import { memo, useState } from "react";\nexport const Card = memo(() => {\n  const [open] = useState(false);\n  const [shown] = useState(true);\n  return open && shown;\n});\n',
      "apps/web/src/one.tsx": 'import { useState } from "react";\nexport function One() {\n  const [items, setItems] = useState<string[]>([]);\n  return [items, setItems];\n}\n',
      "apps/web/src/two.tsx": 'import { useState } from "react";\nexport function A() {\n  return useState(1);\n}\nexport function B() {\n  return useState(2);\n}\n',
    },
    `apps/web/src/card.tsx: Card calls useState on line 3, and again on line 4. ${STATE_FIX}`,
    `apps/web/src/form.tsx: Form calls useState on line 3, and again on lines 4, 6. ${STATE_FIX}`,
    `apps/web/src/use-pager.ts: usePager calls useState on line 3, and again on line 4. ${STATE_FIX}`,
  );
});

test("react follows a hook through a destructured or aliased local", (t) => {
  fails(
    t,
    {
      "apps/web/src/form.tsx": 'import React from "react";\nconst { useState } = React;\nexport function Form() {\n  const [loading] = useState(false);\n  const [value] = useState(0);\n  return [loading, value];\n}\n',
      "apps/web/src/alias.tsx": 'import { useState } from "react";\nconst s = useState;\nexport function Alias() {\n  const [a] = s(0);\n  const [b] = s(1);\n  return a + b;\n}\n',
    },
    `apps/web/src/alias.tsx: Alias calls useState on line 4, and again on line 5. ${STATE_FIX}`,
    `apps/web/src/form.tsx: Form keeps loading in useState on line 4. ${FLAG_FIX}`,
    `apps/web/src/form.tsx: Form calls useState on line 4, and again on line 5. ${STATE_FIX}`,
  );
});

test("react follows a hook through a local declared below the component", (t) => {
  fails(
    t,
    { "apps/web/src/form.tsx": 'import React from "react";\nexport function Form() {\n  const [a] = useState(0);\n  const [b] = useState(1);\n  return a + b;\n}\nconst { useState } = React;\n' },
    `apps/web/src/form.tsx: Form calls useState on line 3, and again on line 4. ${STATE_FIX}`,
  );
});

test("react counts the state of each component apart when two share a name in one file", (t) => {
  const twins = 'import { memo, useState } from "react";\nexport const First = memo(function View() {\n  const [a] = useState(0);\n  return a;\n});\nexport const Second = memo(function View() {\n  const [b] = useState(0);\n  const [c] = useState(1);\n  return b + c;\n});\n';
  passes(t, { "apps/web/src/views.tsx": twins.replace("  const [c] = useState(1);\n", "").replace("b + c", "b") });
  const { cwd, stdout } = react(t, { "apps/web/src/views.tsx": twins.replace("const [a] = useState(0);", "const [a] = useState(0);\n  const [z] = useState(2);") }, "--init");
  assert.equal(stdout, "react: wrote 2 findings to .standard/baselines/react.json\n");
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/react.json"), "utf8")), {
    "react/single-use-state": ["apps/web/src/views.tsx View 2 useState", "apps/web/src/views.tsx View useState"],
  });
});

test("react fails a useState that holds a loading or error flag", (t) => {
  fails(
    t,
    {
      "apps/web/src/report.tsx": 'import { useState } from "react";\nexport default function () {\n  const [isLoading, setIsLoading] = useState(false);\n  return [isLoading, setIsLoading];\n}\n',
      "apps/web/src/use-save.ts": 'import { useState } from "react";\nexport function useSave() {\n  const [error] = useState<Error | null>(null);\n  return error;\n}\n',
      "apps/web/src/count.tsx": 'import { useState } from "react";\nexport function Count() {\n  const [count] = useState(0);\n  return count;\n}\n',
    },
    `apps/web/src/report.tsx: default keeps isLoading in useState on line 3. ${FLAG_FIX}`,
    `apps/web/src/use-save.ts: useSave keeps error in useState on line 3. ${FLAG_FIX}`,
  );
});

test("react fails fetch in a file whose directive prologue holds use client, in any form", (t) => {
  fails(
    t,
    {
      "apps/web/src/client.tsx": '"use client";\nexport async function load() {\n  await fetch("/a");\n  await globalThis.fetch("/b");\n  return useSWR("/c", fetch);\n}\n',
      "apps/web/src/server.tsx": 'export const load = () => fetch("/a");\n',
      "apps/web/src/late.tsx": 'export const load = () => fetch("/a");\n"use client";\n',
      "apps/web/src/param.tsx": '"use client";\nexport const load = (fetch: (url: string) => Promise<unknown>) => fetch("/a");\n',
    },
    `apps/web/src/client.tsx uses fetch on lines 3, 4, 5, and "use client" runs it in the browser. ${FETCH_FIX}`,
  );
});

test("react fails a value import of swr outside each React app's src/lib/swr.ts, Next or Vite, and passes type-only imports", (t) => {
  fails(
    t,
    {
      "apps/web/src/lib/swr.ts": 'import useSWR from "swr";\nimport useSWRInfinite from "swr/infinite";\nexport { useSWR, useSWRInfinite };\n',
      "apps/web/src/feed.tsx": 'import useSWR from "swr";\nimport useSWRInfinite from "swr/infinite";\nexport { useSWR, useSWRInfinite };\n',
      "apps/web/src/types.ts": 'import type { SWRConfiguration } from "swr";\nimport { type Key } from "swr";\nexport type T = [SWRConfiguration, Key];\n',
      "packages/ui/package.json": { dependencies: { react: "19.0.0" } },
      "packages/ui/src/lib/swr.ts": 'export { SWRConfig } from "swr";\n',
      "apps/liff/package.json": { dependencies: { react: "19.0.0" }, devDependencies: { vite: "8.0.0" } },
      "apps/liff/src/lib/swr.ts": 'export { default } from "swr";\n',
      "apps/liff/src/app.tsx": 'import useSWR from "swr";\nexport { useSWR };\n',
    },
    `apps/liff/src/app.tsx imports swr on line 1. ${SWR_FIX}`,
    `apps/web/src/feed.tsx imports swr on line 1. ${SWR_FIX}`,
    `apps/web/src/feed.tsx imports swr/infinite on line 2. ${SWR_FIX}`,
    `packages/ui/src/lib/swr.ts imports swr on line 1. ${SWR_FIX}`,
  );
});

test("react keeps a baseline with one group per rule, and fails a source that does not parse", (t) => {
  const files = { "apps/web/src/form.tsx": 'import { useState } from "react";\nexport function Form() {\n  const [a] = useState(1);\n  const [b] = useState(2);\n  const [loading] = useState(false);\n  return [a, b, loading];\n}\n' };
  const { cwd, stdout, status } = react(t, files, "--init");
  assert.deepEqual([stdout, status], ["react: wrote 3 findings to .standard/baselines/react.json\n", 0]);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/react.json"), "utf8")), {
    "react/no-flag-state": ["apps/web/src/form.tsx Form loading"],
    "react/single-use-state": ["apps/web/src/form.tsx Form useState", "apps/web/src/form.tsx Form useState"],
  });
  const clean = standard(cwd, ["check", "react"]);
  assert.deepEqual([clean.stdout, clean.status], ["react: OK\n", 0]);
  write(cwd, { "apps/web/src/broken.tsx": "export const = 1;\n" });
  git(cwd, "add", "-A");
  const broken = standard(cwd, ["check", "react"]);
  assert.match(broken.stdout, /^react: 1 new findings\.\n {2}apps\/web\/src\/broken\.tsx does not parse, so react cannot read it: .+\. Fix the syntax\.\n/);
  assert.equal(broken.status, 1);
});

test("react passes one useState holding one value, and skips a repository whose package.json files declare no react", (t) => {
  passes(t, { "apps/web/src/one.tsx": 'import { useState } from "react";\nexport function One() {\n  return useState({ name: "", age: 0 });\n}\n' });
  const cwd = tempRepo(t);
  write(cwd, { "package.json": { dependencies: { zod: "4.0.0" } }, "src/a.ts": 'import useSWR from "swr";\n' });
  git(cwd, "add", "-A");
  assert.equal(standard(cwd, ["check", "react"]).stdout, "react: skipped, no tracked package.json declares react\n");
});

function reducers(t, files) {
  const cwd = tempRepo(t);
  write(cwd, {
    ".gitignore": "node_modules\n",
    "package.json": { dependencies: { react: "19.0.0" } },
    "node_modules/react/package.json": { name: "react", version: "19.0.0", types: "index.d.ts" },
    "node_modules/react/index.d.ts": "export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void];\n",
    "tsconfig.json": { compilerOptions: { strict: true, jsx: "preserve", module: "preserve", target: "esnext", noEmit: true }, include: ["src"] },
    ...files,
  });
  mkdirSync(join(cwd, "node_modules"), { recursive: true });
  symlinkSync(join(import.meta.dirname, "../node_modules/typescript"), join(cwd, "node_modules/typescript"));
  git(cwd, "add", "-A");
  return standard(cwd, ["check", "react"]);
}

const STATES = 'import { useReducer } from "react";\ntype Good = { status: "idle" } | { status: "done"; data: string };\ntype Bad = { status: "idle" | "done"; data?: string };\n';

test("react passes a useReducer whose state is a union with a literal status, and fails one it cannot prove is", (t) => {
  const { stdout, stderr, status } = reducers(t, {
    "src/good.tsx": `${STATES}export function Good() {\n  const [{ status }] = useReducer((state: Good, next: Good) => next, { status: "idle" });\n  return status;\n}\n`,
    "src/bad.tsx": `${STATES}export function useBad() {\n  return useReducer((state: Bad, next: Bad) => next, { status: "idle" });\n}\n`,
    "outside/stray.tsx": `${STATES}export function Stray() {\n  return useReducer((state: Good, next: Good) => next, { status: "idle" });\n}\n`,
  });
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    [
      "react: 2 new findings.",
      "  outside/stray.tsx: Stray's useReducer on line 5 is in no TypeScript project, so the check cannot read its state. Add outside/stray.tsx to the include of tsconfig.json.",
      `  src/bad.tsx: useBad's useReducer on line 5 holds Bad, which is not a union whose members each have a literal status. Make the state a union with one member per status, such as { status: "idle" } | { status: "done", items: Item[] }.`,
      NO_BASELINE,
      "",
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("react reads the state of a useReducer called through a local alias", (t) => {
  const { stdout, status } = reducers(t, { "src/alias.tsx": 'import { useReducer } from "react";\nconst reducerHook = useReducer;\nexport function A() {\n  return reducerHook((state: number) => state, 0);\n}\n' });
  assert.equal(stdout, `react: 1 new findings.\n  src/alias.tsx: A's useReducer on line 4 holds number, which is not a union whose members each have a literal status. ${UNION_FIX}\n${NO_BASELINE}\n`);
  assert.equal(status, 1);
});

test("react fails a useReducer state whose members share a status", (t) => {
  const { stdout, status } = reducers(t, {
    "src/twins.tsx": 'import { useReducer } from "react";\ntype State = { status: "ready"; a: string } | { status: "ready"; b: number } | { status: "idle" };\ndeclare const initial: State;\nexport function A() {\n  return useReducer((state: State) => state, initial);\n}\n',
  });
  const members = '{ status: "ready"; a: string; } | { status: "ready"; b: number; } | { status: "idle"; }';
  assert.equal(stdout, `react: 1 new findings.\n  src/twins.tsx: A's useReducer on line 5 holds ${members}, whose members share status "ready". ${UNION_FIX}\n${NO_BASELINE}\n`);
  assert.equal(status, 1);
});
