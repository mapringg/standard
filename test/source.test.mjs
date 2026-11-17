import assert from "node:assert/strict";
import { test } from "node:test";

import { sourceFacts } from "../src/checks/support/source.mjs";

function facts(code, path = "src/a.tsx") {
  const [file] = sourceFacts({ files: () => [path], read: () => code });
  return file;
}

function uses(code) {
  return facts(code).uses.map((use) => `${use.kind} ${use.space === "module" ? "module" : "global"} ${use.path}`);
}

const CASES = [
  ["process.env.API_URL;", ["read global process.env.API_URL"]],
  ['process["env"].API_URL;', ["read global process.env.API_URL"]],
  ["globalThis.process.env;", ["read global process.env"]],
  ["window.JSON.parse(text);", ["call global JSON.parse", "read global text"]],
  ["self.fetch(url);", ["call global fetch", "read global url"]],
  ["(process as any).env;", ["read global process.env"]],
  ["process.env!.A;", ["read global process.env.A"]],
  ["const { env } = process;", ["bind global process", "read global process.env"]],
  ["const { env: { API } } = globalThis.process;", ["bind global process", "read global process.env.API"]],
  ["const { parse } = JSON;", ["bind global JSON", "read global JSON.parse"]],
  ['import { env } from "node:process"; env.A;', ["import module node:process", "import global process.env", "read global process.env.A"]],
  ['import p from "process"; p.env;', ["import module process", "import global process", "read global process.env"]],
  ['import * as p from "node:process"; p.env;', ["import module node:process", "import global process", "read global process.env"]],
  ["import.meta.env.VITE_URL;", ["read global import.meta.env.VITE_URL"]],
  ["function f(JSON) { JSON.parse(x); }", ["read global x"]],
  ["const JSON = y; JSON.parse(1);", ["bind global y", "call global y.parse"]],
  ["{ let fetch = g; fetch(); } fetch();", ["bind global g", "call global g", "call global fetch"]],
  ["function f() { if (a) { var process = 1; } process.env; }", ["read global a"]],
  ["try {} catch (console) { console.log(); }", []],
  ["class console { m() { console.log(); } }", []],
  ["const f = function JSON() { JSON.parse(); };", []],
  ["let x: typeof process.env;", []],
  ["declare const process: any; process.env;", ["read global process.env"]],
  ['import * as React from "react"; React.useMemo(f);', ["import module react", "import module react", "call module react#useMemo", "read global f"]],
  ['import React from "react"; React.memo(C);', ["import module react", "import module react#default", "call module react#memo", "read global C"]],
  ['import { useMemo as m } from "react"; m(f);', ["import module react", "import module react#useMemo", "call module react#useMemo", "read global f"]],
  ['import * as BaseUI from "@base-ui/react"; <BaseUI.Dialog />;', ["import module @base-ui/react", "import module @base-ui/react", "read module @base-ui/react#Dialog"]],
  ['import { Dialog } from "@base-ui/react"; <Dialog.Root><div /></Dialog.Root>;', ["import module @base-ui/react", "import module @base-ui/react#Dialog", "read module @base-ui/react#Dialog.Root"]],
  ["<motion.div />; <Local />;", ["read global motion.div", "read global Local"]],
  ['import type { Z } from "zod"; import { type Y } from "zod";', ["type module zod", "type module zod#Z", "type module zod", "type module zod#Y"]],
  ['import { type Y, z } from "zod";', ["import module zod", "type module zod#Y", "import module zod#z"]],
  ['export { z } from "zod"; export * from "ioredis"; export type { T } from "t";', ["import module zod", "import module zod#z", "import module ioredis", "type module t", "type module t#T"]],
  ['const r = require("ioredis"); await import("zod");', ["import module ioredis", "call global require", "bind module ioredis", "import module zod", "read module zod"]],
  ['import r = require("ioredis");', ["import module ioredis"]],
  ['import { vi as v } from "vitest"; v.mock("m"); const { doMock } = v;', ["import module vitest", "import module vitest#vi", "call module vitest#vi.mock", "bind module vitest#vi", "read module vitest#vi.doMock"]],
  ['const { mock } = vi; vi["mock"]("m");', ["bind global vi", "read global vi.mock", "call global vi.mock"]],
  ["label: for (;;) { break label; }", []],
  ["for (let i = 0, JSON = 1; i < 1; i++) JSON.parse(); for (const fetch of []) fetch();", []],
  ["const o = { toString: 1, [key]: 2, short }; o.a;", ["read global key", "read global short"]],
];

for (const [code, expected] of CASES) {
  test(`sourceFacts reads ${code}`, () => {
    assert.deepEqual(uses(code), expected);
  });
}

test("sourceFacts puts each use on its line and counts every static property read on any object", () => {
  const file = facts("const d = new Date();\nd.toLocaleDateString();\nconst { toLocaleDateString } = d;\nd[`toLocaleDateString`];\n");
  assert.deepEqual(file.members.get("toLocaleDateString"), [2, 3, 4]);
  assert.deepEqual(file.uses, [{ space: "global", path: "Date", kind: "read", line: 1 }]);
});

test("sourceFacts reports a file that does not parse", () => {
  assert.match(facts("const = 1;").error, /./);
});
