import assert from "node:assert/strict";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

function banned(t, banned, files) {
  const cwd = tempRepo(t, { banned });
  write(cwd, files);
  git(cwd, "add", "-A");
  return standard(cwd, ["check", "banned"]);
}

function fails(t, rules, files, ...lines) {
  const { stdout, stderr, status } = banned(t, rules, files);
  assert.equal(stderr, "");
  assert.equal(stdout, lines.map((line) => `banned: ${line}\n`).join(""));
  assert.equal(status, 1);
}

const ZOD = { import: "zod", files: ["apps/web/**"], except: ["apps/web/src/ui/**"], fix: "Import zod/mini." };
const ENV = { global: "process.env", except: ["src/env.ts"], fix: "Read it through src/env.ts." };

test("banned fails a value import of a banned module in its files, and passes its except, zod/mini and type-only imports", (t) => {
  fails(
    t,
    [ZOD],
    {
      "apps/web/src/form.ts": 'import { z } from "zod";\n\nconst schema = await import("zod");\n',
      "apps/web/src/ui/field.ts": 'import { z } from "zod";\n',
      "apps/web/src/mini.ts": 'import * as z from "zod/mini";\n',
      "apps/web/src/types.ts": 'import type { ZodType } from "zod";\nimport { type infer as Infer } from "zod";\n',
      "apps/api/src/schema.ts": 'import { z } from "zod";\n',
    },
    "apps/web/src/form.ts zod: apps/web/src/form.ts uses zod on lines 1, 3. Import zod/mini.",
  );
});

test("banned catches process.env through every form, and passes its except and a shadowing local", (t) => {
  const forms = {
    "src/direct.ts": "export const url = process.env.API_URL;\n",
    "src/computed.ts": 'export const url = process["env"].API_URL;\n',
    "src/global-this.ts": "export const url = globalThis.process.env.API_URL;\n",
    "src/destructured.ts": "const { env } = process;\nexport const url = env.API_URL;\n",
    "src/nested.ts": "const { env: { API_URL } } = window.process;\nexport { API_URL };\n",
    "src/named.ts": 'import { env } from "node:process";\nexport const url = env.API_URL;\n',
    "src/namespace.ts": 'import * as proc from "process";\nexport const url = proc.env.API_URL;\n',
  };
  fails(
    t,
    [ENV],
    {
      ...forms,
      "src/env.ts": "export const url = process.env.API_URL;\n",
      "src/shadowed.ts": "export function read(process: { env: string }) {\n  return process.env;\n}\n",
    },
    "src/computed.ts process.env: src/computed.ts uses process.env on line 1. Read it through src/env.ts.",
    "src/destructured.ts process.env: src/destructured.ts uses process.env on lines 1, 2. Read it through src/env.ts.",
    "src/direct.ts process.env: src/direct.ts uses process.env on line 1. Read it through src/env.ts.",
    "src/global-this.ts process.env: src/global-this.ts uses process.env on line 1. Read it through src/env.ts.",
    "src/named.ts process.env: src/named.ts uses process.env on lines 1, 2. Read it through src/env.ts.",
    "src/namespace.ts process.env: src/namespace.ts uses process.env on line 2. Read it through src/env.ts.",
    "src/nested.ts process.env: src/nested.ts uses process.env on lines 1, 2. Read it through src/env.ts.",
  );
});

test("banned follows a named export through import(), require and the bindings that take them", (t) => {
  fails(
    t,
    [{ import: "ui#Button", fix: "Use ApprovedButton." }],
    {
      "src/lazy.ts": 'export async function load() {\n  const { Button } = await import("ui");\n  return Button;\n}\n',
      "src/member.ts": 'export const load = async () => (await import("ui")).Button;\n',
      "src/required.cjs": 'const { Button } = require("ui");\nmodule.exports = { Button };\n',
      "src/bound.ts": 'const ui = require("ui");\nexport const b = ui.Button;\n',
      "src/other.ts": 'const { Card } = await import("ui");\nexport const c = require("ui").Card;\n',
    },
    "src/bound.ts ui#Button: src/bound.ts uses ui#Button on line 2. Use ApprovedButton.",
    "src/lazy.ts ui#Button: src/lazy.ts uses ui#Button on lines 2, 3. Use ApprovedButton.",
    "src/member.ts ui#Button: src/member.ts uses ui#Button on line 1. Use ApprovedButton.",
    "src/required.cjs ui#Button: src/required.cjs uses ui#Button on lines 1, 2. Use ApprovedButton.",
  );
});

test("banned follows a global through a local that holds its parent", (t) => {
  fails(
    t,
    [{ global: ["JSON.parse", "fetch"], fix: "Use the wrappers." }, ENV],
    {
      "src/json.ts": 'const json = JSON;\nexport const result = json.parse("{}");\n',
      "src/env-alias.ts": "const p = process;\nexport const url = p.env.API_URL;\n",
      "src/fetch.ts": 'let w = window;\nexport const load = () => w.fetch("/");\n',
    },
    "src/env-alias.ts process.env: src/env-alias.ts uses process.env on line 2. Read it through src/env.ts.",
    "src/fetch.ts fetch: src/fetch.ts uses fetch on line 2. Use the wrappers.",
    "src/json.ts JSON.parse: src/json.ts uses JSON.parse on line 2. Use the wrappers.",
  );
});

test("banned follows a local declared below the function that reads it", (t) => {
  fails(
    t,
    [{ global: "JSON.parse", fix: "Use parseJson." }],
    { "src/read.ts": 'export function read(text: string) {\n  return json.parse(text);\n}\nconst json = JSON;\n' },
    "src/read.ts JSON.parse: src/read.ts uses JSON.parse on line 2. Use parseJson.",
  );
});

test("banned bans a property on any object, and the first entry that covers a file wins", (t) => {
  fails(
    t,
    [
      { property: ["toLocaleDateString", "toLocaleTimeString"], files: ["src/format.ts"], fix: "Format here with dateFormatter." },
      { property: "toLocaleDateString", except: ["src/format.ts"], fix: "Use dateFormatter from src/format.ts." },
    ],
    {
      "src/format.ts": "export const day = (d: Date) => d.toLocaleDateString();\n",
      "src/page.tsx": "export const Day = ({ at }: { at: Date }) => {\n  const { toLocaleDateString } = at;\n  return <p>{at.toLocaleDateString()}</p>;\n};\n",
    },
    "src/format.ts .toLocaleDateString: src/format.ts uses .toLocaleDateString on line 1. Format here with dateFormatter.",
    "src/page.tsx .toLocaleDateString: src/page.tsx uses .toLocaleDateString on lines 2, 3. Use dateFormatter from src/format.ts.",
  );
});

test("banned fails a tracked oxlint config that sets a restricted rule anywhere, even to off", (t) => {
  fails(
    t,
    [],
    {
      ".oxlintrc.json": '{ "extends": ["./node_modules/@mapringg/standard/config/oxlint.json"] }\n',
      "apps/api/.oxlintrc.json": '{\n  // the redis files\n  "overrides": [{ "files": ["src/db/redis.ts"], "rules": { "no-restricted-imports": "off", }, }],\n}\n// end',
      "apps/web/oxlint.config.ts": 'export default { rules: { "eslint/no-restricted-properties": ["error", { object: "Date", property: "now" }] } };\n',
    },
    "apps/api/.oxlintrc.json no-restricted-imports: apps/api/.oxlintrc.json sets no-restricted-imports, which bans APIs a second way beside banned. Move its entries to banned in .standard/config.json, and delete the rule from rules and every overrides entry.",
    "apps/web/oxlint.config.ts no-restricted-properties: apps/web/oxlint.config.ts sets no-restricted-properties, which replaces the bans on Reflect from @mapringg/standard/oxlint for the files it covers. Move its entries to banned in .standard/config.json, and delete the rule from rules and every overrides entry.",
  );
});

const MOCK_FIX = "Pass the dependency in as an argument or prop, or run a fake of the service it calls, instead of replacing the module.";

test("banned fails module mocking in every repository through aliases, namespaces, destructuring and globals, and passes a local vi", (t) => {
  fails(
    t,
    [],
    {
      "src/aliased.test.ts": 'import { vi as v } from "vitest";\nv.mock("./db");\n',
      "src/namespace.test.ts": 'import * as V from "vitest";\nV.vi.doMock("./db");\n',
      "src/destructured.test.ts": 'import { vi } from "vitest";\nconst { mock } = vi;\nmock("./db");\n',
      "src/global.test.ts": 'vi.mock("./db");\n',
      "src/jest.test.ts": 'import { jest } from "@jest/globals";\njest.unmock("./db");\n',
      "src/local.test.ts": 'const vi = { mock() {} };\nvi.mock("./db");\n',
    },
    `src/aliased.test.ts vitest#vi.mock: src/aliased.test.ts uses vitest#vi.mock on line 2. ${MOCK_FIX}`,
    `src/destructured.test.ts vitest#vi.mock: src/destructured.test.ts uses vitest#vi.mock on lines 2, 3. ${MOCK_FIX}`,
    `src/global.test.ts vi.mock: src/global.test.ts uses vi.mock on line 1. ${MOCK_FIX}`,
    `src/jest.test.ts @jest/globals#jest.unmock: src/jest.test.ts uses @jest/globals#jest.unmock on line 2. ${MOCK_FIX}`,
    `src/namespace.test.ts vitest#vi.doMock: src/namespace.test.ts uses vitest#vi.doMock on line 2. ${MOCK_FIX}`,
  );
});

test("banned fails a file that re-exports vi or jest, and passes other vitest exports and a direct vi.fn", (t) => {
  const reexport = (path, api, line, name, module) => `${path} export ${api}: ${path} re-exports ${api} on line ${line}. Import ${name} from ${module} where you use it.`;
  fails(
    t,
    [],
    {
      "src/named.ts": 'export { vi } from "vitest";\n',
      "src/renamed.ts": 'export { expect, jest as runner } from "@jest/globals";\n',
      "src/all.ts": 'export * from "vitest";\n',
      "src/all-as.ts": 'export * as V from "vitest";\n',
      "src/local.ts": 'import { vi } from "vitest";\nexport { vi };\nexport const v = vi;\n',
      "src/global.ts": "export default vi;\n",
      "src/meta.ts": "export const runner = import.meta.vitest;\n",
      "src/other.ts": 'export { expect } from "vitest";\nexport * from "vitest/node";\n',
      "src/spy.test.ts": 'import { vi } from "vitest";\nimport * as helper from "./named";\nvi.fn();\nvi.spyOn(console, "log");\nhelper.vi.fn();\n',
    },
    reexport("src/all-as.ts", "vitest#vi", 1, "vi", "vitest"),
    reexport("src/all.ts", "vitest#vi", 1, "vi", "vitest"),
    reexport("src/global.ts", "vi", 1, "vi", "vitest"),
    "src/local.ts export vitest#vi: src/local.ts re-exports vitest#vi on lines 2, 3. Import vi from vitest where you use it.",
    reexport("src/meta.ts", "vitest#vi", 1, "vi", "vitest"),
    reexport("src/named.ts", "vitest#vi", 1, "vi", "vitest"),
    reexport("src/renamed.ts", "@jest/globals#jest", 1, "jest", "@jest/globals"),
  );
});

test("banned treats import.meta.vitest as the vitest module", (t) => {
  fails(
    t,
    [],
    {
      "src/sum.ts": 'export const sum = 1;\nif (import.meta.vitest) {\n  const { vi } = import.meta.vitest;\n  vi.doMock("./db");\n  import.meta.vitest.vi.mock("./db");\n  vi.fn();\n}\n',
    },
    `src/sum.ts vitest#vi.doMock: src/sum.ts uses vitest#vi.doMock on line 4. ${MOCK_FIX}`,
    `src/sum.ts vitest#vi.mock: src/sum.ts uses vitest#vi.mock on line 5. ${MOCK_FIX}`,
  );
});

test("banned fails every vitest and jest member that replaces or restores a module, and passes the ones that read the real module", (t) => {
  const vitest = ["doUnmock", "importMock"];
  const jest = ["setMock", "dontMock", "deepUnmock", "unstable_unmockModule", "enableAutomock", "disableAutomock", "autoMockOn", "autoMockOff", "requireMock", "createMockFromModule", "onGenerateMock"];
  const files = {
    ...Object.fromEntries(vitest.map((name) => [`src/vi-${name}.test.ts`, `import { vi } from "vitest";\nvi.${name}("./db");\n`])),
    ...Object.fromEntries(jest.map((name) => [`src/jest-${name}.test.ts`, `import { jest } from "@jest/globals";\njest.${name}("./db");\n`])),
    "src/global-setMock.test.ts": 'jest.setMock("./db", {});\n',
    "src/real.test.ts": [
      'import { vi } from "vitest";',
      'import { jest } from "@jest/globals";',
      'await vi.importActual("./db");',
      'jest.requireActual("./db");',
      "vi.resetModules();",
      "jest.isolateModules(() => {});",
      "vi.mocked(vi.fn());",
      "",
    ].join("\n"),
  };
  const line = (path, api, at) => `${path} ${api}: ${path} uses ${api} on line ${at}. ${MOCK_FIX}`;
  fails(
    t,
    [],
    files,
    line("src/global-setMock.test.ts", "jest.setMock", 1),
    ...jest.toSorted().map((name) => line(`src/jest-${name}.test.ts`, `@jest/globals#jest.${name}`, 2)),
    ...vitest.toSorted().map((name) => line(`src/vi-${name}.test.ts`, `vitest#vi.${name}`, 2)),
  );
});

test("banned catches a banned export through a longer chain such as .call", (t) => {
  fails(
    t,
    [{ import: "react#useMemo", fix: "Let the React Compiler memoize." }],
    { "src/view.tsx": 'import React from "react";\nexport const value = React.useMemo.call(null, () => 1, []);\n' },
    "src/view.tsx react#useMemo: src/view.tsx uses react#useMemo on line 2. Let the React Compiler memoize.",
  );
});

test("banned passes a repository with no banned uses and no restricted oxlint rules", (t) => {
  const { stdout, status } = banned(t, [ZOD, ENV], { "src/env.ts": "export const url = process.env.API_URL;\n", "src/a.ts": "export const a = 1;\n" });
  assert.deepEqual([stdout, status], ["banned: OK\n", 0]);
});

test("banned names the fix for a malformed entry", (t) => {
  const cases = [
    [{}, ".standard/config.json banned must be a list."],
    [[{ import: "zod", global: "JSON.parse", fix: "x" }], ".standard/config.json banned[0] names what it bans with import, global or property; give it exactly one."],
    [[{ global: "window.fetch", fix: "x" }], '.standard/config.json banned[0].global has "window.fetch", and window aliases the global object. Write the name after it, such as "fetch", which also matches window.fetch and globalThis.fetch.'],
    [[{ import: ["zod#"], fix: "x" }], '.standard/config.json banned[0].import has "zod#". Write "zod" for the whole module or "zod#z" for one export.'],
    [[{ property: "a.b", fix: "x" }], '.standard/config.json banned[0].property has "a.b". Write one property name such as "toLocaleDateString".'],
    [[{ global: [], fix: "x" }], '.standard/config.json banned[0].global must name at least one API. Write a dotted name such as "process.env" or "import.meta.env".'],
    [[{ global: "JSON.parse", files: [], fix: "x" }], ".standard/config.json banned[0].files must be a list of one or more non-empty strings."],
    [[{ global: "JSON.parse" }], '.standard/config.json banned[0].fix must say what to use instead, such as "Use the helpers in src/env.ts."'],
    [[{ global: "JSON.parse", fix: "x", allow: [] }], '.standard/config.json has an unknown key "banned[0].allow". Known keys: banned[0].import, banned[0].global, banned[0].property, banned[0].files, banned[0].except, banned[0].fix.'],
  ];
  for (const [rules, message] of cases) {
    const { stderr, status } = banned(t, rules, {});
    assert.equal(stderr, `standard: ${message}\n`);
    assert.equal(status, 1);
  }
});

test("wiring fails a repo plugin rule that banned replaces, in any plugin package", (t) => {
  const cwd = tempRepo(t, {});
  write(cwd, { "packages/oxlint-plugin-app/rules/no-process-env.ts": "export {};\n", "packages/oxlint-plugin-app/rules/no-naive-time.ts": "export {};\n" });
  git(cwd, "add", "-A");
  const { stdout } = standard(cwd, ["check", "wiring"]);
  assert.match(stdout, /^wiring: packages\/oxlint-plugin-app\/rules\/no-process-env\.ts: Delete packages\/oxlint-plugin-app\/rules\/no-process-env\.ts, which the banned check replaces\.$/m);
  assert.doesNotMatch(stdout, /no-naive-time/);
});

const CONSOLE = { global: "console", fix: "Use the logger." };

test("banned reads an Astro component's frontmatter and scripts on their own lines, and a frontmatter return, but not a capitalized SCRIPT component", (t) => {
  fails(
    t,
    [CONSOLE],
    {
      "src/pages/index.astro": [
        "---",
        'import Layout from "../layouts/Layout.astro";',
        "if (!Astro.locals.user) return Astro.redirect(\"/login\");",
        'console.log("frontmatter");',
        "---",
        "<Layout>",
        '  <script>',
        '    console.warn("module");',
        "  </script>",
        "</Layout>",
        '<script TYPE="module">console.error("upper")</script >',
        '<SCRIPT>console.error("a component, as Astro reads a capitalized tag")</SCRIPT>',
        "",
      ].join("\n"),
    },
    "src/pages/index.astro console: src/pages/index.astro uses console on lines 4, 8, 11. Use the logger.",
  );
});

test("banned skips Astro markup, comments, styles and data scripts, and reads an is:inline script after a self-closing one", (t) => {
  fails(
    t,
    [CONSOLE],
    {
      "src/components/Card.astro": [
        "<p>console.log()</p>",
        "<!-- <script>console.log(\"commented\")</script> -->",
        '<script type="application/ld+json">{"@context": "https://schema.org", "name": "console.log"}</script>',
        "<style>p::after { content: \"<script>console.log()</script>\"; }</style>",
        '<script src="/analytics.js" />',
        '<script is:inline data-label="a > b">',
        '  console.info("inline");',
        "</script>",
        "",
      ].join("\n"),
    },
    "src/components/Card.astro console: src/components/Card.astro uses console on line 7. Use the logger.",
  );
});

test("banned reads Astro frontmatter past a fence line in a string, skips script text in markup strings, and reads define:vars scripts with escaped quotes", (t) => {
  fails(
    t,
    [CONSOLE],
    {
      "src/pages/fence.astro": ["---", "const example = `one", "---", "two`;", "console.log(example);", "---", "<p>{example}</p>", ""].join("\n"),
      "src/pages/strings.astro": [
        '<p>{"<script>not javascript</script>"}</p>',
        '<div data-example="<script>not javascript</script>">hi</div>',
        "{Astro.props.debug && <script>console.debug(\"nested\")</script>}",
        "",
      ].join("\n"),
      "src/pages/vars.astro": [
        "<script define:vars={{ label: 'It\\'s ready' }}>console.log(label);</script>",
        '<script define:vars={{ label: "Say \\"hi\\"" }}>console.log(label);</script>',
        "",
      ].join("\n"),
    },
    "src/pages/fence.astro console: src/pages/fence.astro uses console on line 5. Use the logger.",
    "src/pages/strings.astro console: src/pages/strings.astro uses console on line 3. Use the logger.",
    "src/pages/vars.astro console: src/pages/vars.astro uses console on lines 1, 2. Use the logger.",
  );
});
