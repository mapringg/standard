import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, WIRED, write } from "./helpers.mjs";


const WORKSPACE = {
  "package.json": { name: "root", private: true, dependencies: { zod: "4.0.0" } },
  "apps/api/package.json": { name: "api", exports: { ".": "./src/app.ts", "./auth": "./src/auth/index.ts" } },
  "apps/api/tsconfig.json": { compilerOptions: { module: "nodenext" } },
  "apps/api/src/app.ts": 'export { session } from "./auth/index.ts";\n',
  "apps/api/src/auth/index.ts": 'export { session } from "./session.ts";\n',
  "apps/api/src/auth/session.ts": "export const session = 1;\n",
  "apps/api/src/db/client.ts": "export const db = 1;\n",
  "apps/api/src/features/a/index.ts": "export const a = 1;\n",
  "apps/api/src/features/a/store.ts": "export const store = 1;\n",
  "apps/web/package.json": { name: "web", dependencies: { api: "workspace:*" } },
  "apps/web/tsconfig.json": { compilerOptions: { module: "esnext", moduleResolution: "bundler", paths: { "@/*": ["./src/*"] } } },
  "apps/web/src/app/page.tsx": "export const page = 1;\n",
  "apps/web/src/lib/format.ts": "export const format = 1;\n",
  "packages/tokens/package.json": { name: "tokens" },
  "packages/tokens/index.ts": "export const color = 1;\n",
  "packages/tokens/colors.ts": "export const red = 1;\n",
};

const MODULES = { folders: ["apps/api/src/*", "apps/api/src/features/*"], entries: ["index", "routes"], open: ["apps/api/src/db"], except: ["**/*.test.ts"] };
const FORBID = { files: ["apps/web/src/features/**"], imports: ["apps/web/src/app/**"], fix: "Let the route compose the feature." };

function repoWith(t, files, boundaries = { modules: [MODULES], forbid: [FORBID] }) {
  const cwd = tempRepo(t, { boundaries });
  write(cwd, { ...WORKSPACE, ...files });
  mkdirSync(join(cwd, "node_modules"), { recursive: true });
  symlinkSync(join(import.meta.dirname, "../node_modules/typescript"), join(cwd, "node_modules/typescript"));
  for (const [from, to] of [["apps/web/node_modules/api", "../../api"], ["apps/web/node_modules/tokens", "../../../packages/tokens"]]) {
    mkdirSync(join(cwd, from, ".."), { recursive: true });
    symlinkSync(to, join(cwd, from));
  }
  git(cwd, "add", "-A");
  return cwd;
}

function findings(cwd) {
  const { stdout, stderr, status } = standard(cwd, ["check", "boundaries"]);
  assert.doesNotMatch(stderr, /^standard: /m);
  return { lines: stdout.trimEnd().split("\n"), status };
}

test("boundaries passes imports through a module entry, inside one module, into an open module, and through a package's exports", (t) => {
  const cwd = repoWith(t, {
    "apps/api/src/features/b/index.ts": [
      'import { a } from "../a/index.ts";',
      'import { session } from "../../auth/index.ts";',
      'import { db } from "../../db/client.ts";',
      'import { store } from "./store.ts";',
      "export const b = [a, session, db, store];",
      "",
    ].join("\n"),
    "apps/api/src/features/b/store.ts": "export const store = 1;\n",
    "apps/api/src/features/a/store.test.ts": 'import { session } from "../../auth/session.ts";\nexport const t = session;\n',
    "apps/web/src/features/x.ts": 'import { session } from "api/auth";\nimport type { z } from "zod";\nimport { format } from "@/lib/format";\nimport { readFileSync } from "node:fs";\nexport const x = [session, format, readFileSync];\nexport type Z = z.ZodType;\n',
    "apps/web/src/app/route.ts": 'import { color } from "tokens";\nexport const route = color;\n',
  });
  assert.deepEqual(findings(cwd), { lines: ["boundaries: OK"], status: 0 });
});

test("boundaries fails an import that reaches another workspace package by path, or past its exports", (t) => {
  const cwd = repoWith(t, {
    "apps/web/src/lib/a.ts": 'export { session } from "../../../api/src/auth/session.ts";\n',
    "apps/web/src/lib/b.ts": 'export { session } from "api/src/auth/session.ts";\n',
    "apps/web/src/lib/c.ts": 'export { red } from "tokens/colors.ts";\n',
  });
  assert.deepEqual(findings(cwd), {
    lines: [
      'boundaries: apps/web/src/lib/a.ts imports ../../../api/src/auth/session.ts: apps/api/src/auth/session.ts belongs to apps/api, so import it as "api" or a subpath its exports list, not by path.',
      'boundaries: apps/web/src/lib/b.ts imports api/src/auth/session.ts: "api/src/auth/session.ts" is not in the exports of the workspace package api. Import a subpath its exports list, or add this one there.',
      'boundaries: apps/web/src/lib/c.ts imports tokens/colors.ts: tokens has no exports field, so "tokens/colors.ts" reaches into its files. Add the subpath to exports in packages/tokens/package.json, or import "tokens".',
    ],
    status: 1,
  });
});

test("boundaries fails closed on a file that does not parse and an import that does not resolve, and reads a literal import()", (t) => {
  const cwd = repoWith(t, {
    "apps/web/src/lib/broken.ts": "export const = ;\n",
    "apps/web/src/lib/missing.ts": 'export { gone } from "./gone";\nexport { other } from "@/lib/other";\nexport { left } from "left-pad";\n',
    "apps/web/src/lib/dynamic.ts": "export const load = (name: string) => [import(`./locales/${name}.ts`), import(`./absent`)];\n",
  });
  const { lines, status } = findings(cwd);
  assert.match(lines[0], /^boundaries: apps\/web\/src\/lib\/broken\.ts imports \(parse\): apps\/web\/src\/lib\/broken\.ts does not parse, so its imports cannot be checked: .+ Fix the syntax\.$/);
  assert.deepEqual(lines.slice(1), [
    'boundaries: apps/web/src/lib/dynamic.ts imports ./absent: "./absent" in apps/web/src/lib/dynamic.ts does not resolve. Fix the path so it names a file.',
    'boundaries: apps/web/src/lib/missing.ts imports ./gone: "./gone" in apps/web/src/lib/missing.ts does not resolve. Fix the path so it names a file.',
    'boundaries: apps/web/src/lib/missing.ts imports @/lib/other: "@/lib/other" in apps/web/src/lib/missing.ts does not resolve, and apps/web/package.json does not declare @/lib. Fix the tsconfig paths alias it uses, or add @/lib to apps/web/package.json and install it.',
    'boundaries: apps/web/src/lib/missing.ts imports left-pad: "left-pad" in apps/web/src/lib/missing.ts does not resolve, and apps/web/package.json does not declare left-pad. Fix the tsconfig paths alias it uses, or add left-pad to apps/web/package.json and install it.',
  ]);
  assert.equal(status, 1);
});

test("boundaries keeps no baseline, and pending holds it off", (t) => {
  const cwd = repoWith(t, { "apps/web/src/lib/a.ts": 'export { session } from "../../../api/src/auth/session.ts";\n' });
  const init = standard(cwd, ["check", "boundaries", "--init"]);
  assert.equal(init.stderr, "standard: boundaries allows no findings, so it has no baseline for --init. Fix what it finds.\n");
  assert.equal(init.status, 1);

  write(cwd, { ".standard/config.json": { pending: ["boundaries"] } });
  const pending = standard(cwd, ["check", "boundaries"]);
  assert.deepEqual([pending.stdout, pending.status], ["boundaries: pending in .standard/config.json, so it did not run\n", 0]);
});

test("boundaries reads every literal import form from the syntax tree, escapes and $ included", (t) => {
  const cwd = repoWith(t, {
    "apps/api/src/pri$vate.ts": "export const hidden = 1;\n",
    "apps/web/src/lib/forms.ts": [
      'void import("../../../api/src/auth/sessi\\u006fn.ts");',
      'void import(`../../../api/src/pri$vate.ts`);',
      'export {} from "../../../api/src/db/client.ts";',
      'import legacy = require("../../../api/src/features/a/index.ts");',
      'const required = require("./absent.cjs");',
      "export const all = [legacy, required];",
      "",
    ].join("\n"),
  });
  const keys = findings(cwd).lines.map((line) => line.split(": ")[1]);
  assert.deepEqual(keys, [
    "apps/web/src/lib/forms.ts imports ../../../api/src/auth/session.ts",
    "apps/web/src/lib/forms.ts imports ../../../api/src/pri$vate.ts",
    "apps/web/src/lib/forms.ts imports ../../../api/src/db/client.ts",
    "apps/web/src/lib/forms.ts imports ../../../api/src/features/a/index.ts",
    "apps/web/src/lib/forms.ts imports ./absent.cjs",
  ]);
});

test("boundaries checks a package-shaped tsconfig alias against the package's exports", (t) => {
  const cwd = repoWith(t, {
    "apps/api/src/private.ts": "export const hidden = 1;\n",
    "apps/web/tsconfig.json": { compilerOptions: { module: "esnext", moduleResolution: "bundler", paths: { "api/hidden": ["../api/src/private.ts"], "@/*": ["./src/*"] } } },
    "apps/web/src/lib/deep.ts": 'export { hidden } from "api/hidden";\n',
  });
  assert.deepEqual(findings(cwd), {
    lines: [
      'boundaries: apps/web/src/lib/deep.ts imports api/hidden: "api/hidden" reaches apps/api/src/private.ts through tsconfig paths, but the exports of api lists no such subpath. Import a subpath its exports list, or add this one there.',
    ],
    status: 1,
  });
});

const COMPILERS = { "7": join(import.meta.dirname, "../node_modules/typescript"), "6": join(import.meta.dirname, "../node_modules/typescript-6") };

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries resolves as TypeScript ${major} does: the require condition in a .cts file, .d.ts behind a .js specifier, and an asset through exports`, (t) => {
    const cwd = repoWith(t, {
      "apps/api/package.json": { name: "api", exports: { "./condition": { require: "./src/required.ts", import: "./src/imported.ts" }, "./logo.png": "./logo.png" } },
      "apps/api/src/imported.ts": "export const value = 1;\n",
      "apps/api/logo.png": "png",
      "apps/node/package.json": { name: "node-app", dependencies: { api: "workspace:*" } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/src/condition.cts": 'import { value } from "api/condition";\nexport const a = value;\n',
      "apps/node/src/condition.mts": 'import { value } from "api/condition";\nexport const a = value;\n',
      "apps/node/src/declaration.d.ts": "export declare const value: number;\n",
      "apps/node/src/uses-declaration.mts": 'import type { value } from "./declaration.js";\nexport type V = typeof value;\n',
      "apps/node/src/logo.mts": 'import logo from "api/logo.png";\nexport const src = logo;\n',
    });
    mkdirSync(join(cwd, "apps/node/node_modules"));
    symlinkSync(join(cwd, "apps/api"), join(cwd, "apps/node/node_modules/api"));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    const missing = (file, specifier) => `boundaries: ${file} imports ${specifier}: "${specifier}" is not in the exports of the workspace package api. Import a subpath its exports list, or add this one there.`;
    assert.deepEqual(findings(cwd), {
      lines: [missing("apps/node/src/condition.cts", "api/condition")],
      status: 1,
    });
  });
}

test("boundaries resolves a createRequire require from its anchor, under any name, and skips one with a computed anchor", (t) => {
  const cwd = repoWith(t, {
    "apps/web/scripts/anchor.mjs": [
      'import { createRequire } from "node:module";',
      'const require = createRequire(new URL("../../api/package.json", import.meta.url));',
      'require("./src/auth/session.ts");',
      "const req = createRequire(import.meta.url);",
      'req("../../api/src/db/client.ts");',
      'const computed = createRequire(process.cwd() + "/x.js");',
      'computed("./absent.cjs");',
      "",
    ].join("\n"),
    "scripts/browser.mjs": 'import { createRequire } from "node:module";\nconst load = createRequire(new URL("../apps/web/package.json", import.meta.url));\nexport const browser = load("only-web");\n',
    "apps/web/node_modules/only-web/package.json": { name: "only-web", main: "index.js" },
    "apps/web/node_modules/only-web/index.js": "module.exports = 1;\n",
  });
  assert.deepEqual(findings(cwd), {
    lines: [
      'boundaries: apps/web/scripts/anchor.mjs imports ./src/auth/session.ts: apps/api/src/auth/session.ts belongs to apps/api, so import it as "api" or a subpath its exports list, not by path.',
      'boundaries: apps/web/scripts/anchor.mjs imports ../../api/src/db/client.ts: apps/api/src/db/client.ts belongs to apps/api, so import it as "api" or a subpath its exports list, not by path.',
    ],
    status: 1,
  });
});

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries follows TypeScript ${major} past an exports condition whose target is missing, and fails an alias of a workspace package that does not resolve`, (t) => {
    const cwd = repoWith(t, {
      "apps/api/package.json": { name: "api", exports: { "./fallback": { types: "./missing.d.ts", import: "./src/required.ts" }, "./gone": { types: "./missing.d.ts" } } },
      "apps/api/src/required.ts": "export const value = 1;\n",
      "apps/node/package.json": { name: "node-app", dependencies: { api: "workspace:*", "api-alias": "workspace:api@*" } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/src/direct.mts": 'import { value } from "api/fallback";\nexport const a = value;\n',
      "apps/node/src/alias.mts": 'import { value } from "api-alias/fallback";\nexport const b = value;\n',
      "apps/node/src/gone.mts": 'import { value } from "api-alias/gone";\nexport const c = value;\n',
    });
    mkdirSync(join(cwd, "apps/node/node_modules"));
    symlinkSync(join(cwd, "apps/api"), join(cwd, "apps/node/node_modules/api"));
    symlinkSync(join(cwd, "apps/api"), join(cwd, "apps/node/node_modules/api-alias"));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    assert.deepEqual(findings(cwd), {
      lines: [
        'boundaries: apps/node/src/alias.mts imports api-alias/fallback: apps/api/src/required.ts belongs to apps/api, so import it as "api" or a subpath its exports list, not by path.',
        'boundaries: apps/node/src/gone.mts imports api-alias/gone: "api-alias/gone" is not in the exports of the workspace package api-alias. Import a subpath its exports list, or add this one there.',
      ],
      status: 1,
    });
  });
}

test("boundaries resolves each require call through its nearest binding, so a parameter shadows it and each scope keeps its own anchor", (t) => {
  const cwd = repoWith(t, {
    "apps/web/scripts/param-shadow.mjs": 'import { createRequire } from "node:module";\nconst req = createRequire(import.meta.url);\nfunction f(req) { req("./not-a-module"); }\nf((x) => x);\n',
    "apps/web/scripts/creator-shadow.mjs": 'import { createRequire as cr } from "node:module";\nfunction f(cr) {\n  const req = cr(import.meta.url);\n  req("./not-a-module");\n}\nf(() => (x) => x);\n',
    "apps/web/scripts/scope-collision.mjs": [
      'import { createRequire } from "node:module";',
      'const req = createRequire(new URL("../../api/package.json", import.meta.url));',
      'req("./src/auth/session.ts");',
      "function f() {",
      "  const req = createRequire(import.meta.url);",
      '  req("./private.ts");',
      "}",
      "f();",
      'function later() { return late("./src/db/client.ts"); }',
      'const late = createRequire(new URL("../../api/package.json", import.meta.url));',
      "later();",
      "",
    ].join("\n"),
    "apps/web/scripts/private.ts": "export const value = 1;\n",
  });
  const path = (target, specifier) => `boundaries: apps/web/scripts/scope-collision.mjs imports ${specifier}: ${target} belongs to apps/api, so import it as "api" or a subpath its exports list, not by path.`;
  assert.deepEqual(findings(cwd), {
    lines: [path("apps/api/src/auth/session.ts", "./src/auth/session.ts"), path("apps/api/src/db/client.ts", "./src/db/client.ts")],
    status: 1,
  });
});

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries takes the exports target TypeScript ${major} takes when an earlier one is missing: inside a nested branch, after default, and along an array`, (t) => {
    const cwd = repoWith(t, {
      "apps/api/package.json": {
        name: "api",
        type: "module",
        exports: {
          "./nested": { types: { import: "./missing.d.ts", default: "./src/required.ts" }, import: "./src/other.ts" },
          "./default-first": { default: "./missing.d.ts", import: "./src/required.ts" },
          "./array": ["./missing.d.ts", "./src/required.ts"],
        },
      },
      "apps/api/src/required.ts": 'export const value: "required" = "required";\n',
      "apps/api/src/other.ts": 'export const value: "other" = "other";\n',
      "apps/node/package.json": { name: "node-app", dependencies: { "api-alias": "workspace:api@*" } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/src/nested.mts": 'import { value } from "api-alias/nested";\nexport const a: "required" = value;\n',
      "apps/node/src/default-first.mts": 'import { value } from "api-alias/default-first";\nexport const b: "required" = value;\n',
      "apps/node/src/array.mts": 'import { value } from "api-alias/array";\nexport const c: "required" = value;\n',
    });
    mkdirSync(join(cwd, "apps/node/node_modules"));
    symlinkSync(join(cwd, "apps/api"), join(cwd, "apps/node/node_modules/api-alias"));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    const required = (file, specifier) => `boundaries: apps/node/src/${file} imports ${specifier}: apps/api/src/required.ts belongs to apps/api, so import it as "api" or a subpath its exports list, not by path.`;
    assert.deepEqual(findings(cwd), {
      lines: [required("array.mts", "api-alias/array"), required("default-first.mts", "api-alias/default-first"), required("nested.mts", "api-alias/nested")],
      status: 1,
    });
  });
}

test("boundaries reads only a const loader that an imported or const createRequire makes, and a default sees only the parameters", (t) => {
  const api = 'new URL("../../api/package.json", import.meta.url)';
  const cwd = repoWith(t, {
    "apps/web/scripts/reanchor.mjs": `import { createRequire } from "node:module";\nlet r = createRequire(import.meta.url);\nr = createRequire(${api});\nr("./src/db/client.ts");\n`,
    "apps/web/scripts/reassigned.mjs": `import { createRequire } from "node:module";\nlet r = createRequire(${api});\nr = (x) => x;\nr("./missing.ts");\n`,
    "apps/web/scripts/destructured.mjs": `import { createRequire } from "node:module";\nconst { r } = { r: createRequire(${api}) };\nr("./missing.ts");\n`,
    "apps/web/scripts/creator-destructured.mjs": `import * as m from "node:module";\nconst { createRequire } = m;\nconst r = createRequire(${api});\nr("./missing.ts");\n`,
    "apps/web/scripts/default-param.mjs": `import { createRequire } from "node:module";\nconst r = createRequire(${api});\nfunction f(x = r("./src/db/client.ts")) {\n  const r = (y) => y;\n  return x;\n}\nf();\n`,
    "apps/web/scripts/const-module.cjs": 'const m = require("node:module");\nconst r = m.createRequire(__filename);\nr("./missing.cjs");\n',
    "apps/web/scripts/with-scope.cjs": 'with ({ require: (x) => x }) {\n  require("./missing.cjs");\n}\n',
  });
  assert.deepEqual(findings(cwd), {
    lines: [
      'boundaries: apps/web/scripts/const-module.cjs imports ./missing.cjs: "./missing.cjs" in apps/web/scripts/const-module.cjs does not resolve. Fix the path so it names a file.',
      'boundaries: apps/web/scripts/default-param.mjs imports ./src/db/client.ts: apps/api/src/db/client.ts belongs to apps/api, so import it as "api" or a subpath its exports list, not by path.',
    ],
    status: 1,
  });
});

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries stops as TypeScript ${major} does at a null or invalid exports target, and follows an imports target to another package`, (t) => {
    const cwd = repoWith(t, {
      "apps/api/package.json": {
        name: "api",
        type: "module",
        exports: {
          "./null-condition": { types: null, import: "./src/required.ts" },
          "./null-array": [null, "./src/required.ts"],
          "./inner-parent": { types: "./missing.d.ts", import: "./sub/../src/required.ts" },
          "./escape": { types: "./missing.d.ts", import: "./../outside.ts" },
        },
      },
      "apps/api/src/required.ts": 'export const value: "required" = "required";\n',
      "apps/outside.ts": 'export const value: "required" = "required";\n',
      "apps/node/package.json": { name: "node-app", type: "module", dependencies: { api: "workspace:*" }, imports: { "#other": { types: "./missing.d.ts", import: "other" } } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/node_modules/other/package.json": { name: "other", type: "module", exports: "./index.ts" },
      "apps/node/node_modules/other/index.ts": 'export const value: "other" = "other";\n',
      "apps/node/src/private.mts": 'import { value } from "#other";\nexport const v: "other" = value;\n',
      ...Object.fromEntries(["null-condition", "null-array", "inner-parent", "escape"].map((name) => [`apps/node/src/${name}.mts`, `import { value } from "api/${name}";\nexport const v = value;\n`])),
    });
    symlinkSync(join(cwd, "apps/api"), join(cwd, "apps/node/node_modules/api"));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    const unexported = (name) => `boundaries: apps/node/src/${name}.mts imports api/${name}: "api/${name}" is not in the exports of the workspace package api. Import a subpath its exports list, or add this one there.`;
    assert.deepEqual(findings(cwd), {
      lines: ["escape", "inner-parent", "null-array", "null-condition"].map(unexported),
      status: 1,
    });
  });
}

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries takes the declaration TypeScript ${major} takes: a versioned types condition, typesVersions, a declaration after a JavaScript target, and an imports fallback past a missing package`, (t) => {
    const literal = (value) => `export declare const value: "${value}";\n`;
    const cwd = repoWith(t, {
      "packages/versioned/package.json": { name: "versioned", type: "module", exports: { "types@>=5.2": "./modern/index.d.ts", types: "./legacy/index.d.ts", default: "./index.js" } },
      "packages/versioned/modern/index.d.ts": literal("modern"),
      "packages/versioned/legacy/index.d.ts": literal("legacy"),
      "packages/versioned/index.js": 'export const value = "modern";\n',
      "packages/routed/package.json": { name: "routed", type: "module", types: "./index.d.ts", typesVersions: { ">=5.2": { "*": ["modern/*"] } } },
      "packages/routed/index.d.ts": literal("legacy"),
      "packages/routed/modern/index.d.ts": literal("modern"),
      "packages/js-first/package.json": { name: "js-first", type: "module", exports: { import: "./untyped.js", default: "./types.d.ts" } },
      "packages/js-first/untyped.js": 'export const value = "modern";\n',
      "packages/js-first/types.d.ts": literal("modern"),
      "apps/node/package.json": { name: "node-app", type: "module", imports: { "#x": { types: "optional-types", default: "./src/required.ts" } } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/src/required.ts": 'export const value: "required" = "required";\n',
      "apps/node/src/fallback.mts": 'import { value } from "#x";\nexport const v: "required" = value;\n',
      ...Object.fromEntries(["versioned", "routed", "js-first"].map((name) => [`apps/node/src/${name}.mts`, `import { value } from "${name}-alias";\nexport const v: "modern" = value;\n`])),
    });
    mkdirSync(join(cwd, "apps/node/node_modules"));
    for (const name of ["versioned", "routed", "js-first"]) symlinkSync(join(cwd, "packages", name), join(cwd, `apps/node/node_modules/${name}-alias`));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    const path = (name, target) => `boundaries: apps/node/src/${name}.mts imports ${name}-alias: packages/${name}/${target} belongs to packages/${name}, so import it as "${name}" or a subpath its exports list, not by path.`;
    assert.deepEqual(findings(cwd), {
      lines: [path("js-first", "types.d.ts"), path("routed", "modern/index.d.ts"), path("versioned", "modern/index.d.ts")],
      status: 1,
    });
  });
}

test("boundaries fails a deep import into another module, resolved through the file's own folder, and names its entries", (t) => {
  const cwd = repoWith(t, {
    "apps/api/src/features/b/index.ts": 'import type { store } from "../a/store.ts";\nexport type B = typeof store;\n',
  });
  assert.deepEqual(findings(cwd), {
    lines: [
      "boundaries: apps/api/src/features/b/index.ts imports ../a/store.ts: apps/api/src/features/a/store.ts is inside the module apps/api/src/features/a. Import it through apps/api/src/features/a/index or apps/api/src/features/a/routes, and export what you need there.",
    ],
    status: 1,
  });
});

test("boundaries resolves a tsconfig paths alias before it matches a forbid rule, and prints the rule's fix", (t) => {
  const cwd = repoWith(t, { "apps/web/src/features/x.ts": 'export { page } from "@/app/page";\n' });
  assert.deepEqual(findings(cwd), {
    lines: [
      'boundaries: apps/web/src/features/x.ts imports @/app/page: apps/web/src/app/page.tsx matches boundaries.forbid "apps/web/src/app/**". Let the route compose the feature.',
    ],
    status: 1,
  });
});

test("the config rejects a boundaries rule without what it needs, and names the field", (t) => {
  const cases = [
    [{ modules: [{ folders: ["src/*"] }] }, ".standard/config.json boundaries.modules[0].entries must be a list of one or more non-empty strings.\n"],
    [{ modules: [{ folders: ["src/*"], entries: ["index.ts"] }] }, '.standard/config.json boundaries.modules[0].entries names files without folder or extension, such as "index".\n'],
    [{ forbid: [{ files: ["a/**"], imports: ["b/**"] }] }, '.standard/config.json boundaries.forbid[0].fix must say what to do instead, such as "Let the route compose the feature."\n'],
  ];
  for (const [boundaries, message] of cases) {
    const { stderr, status } = standard(tempRepo(t, { boundaries }), ["check"]);
    assert.equal(stderr, `standard: ${message}`);
    assert.equal(status, 1);
  }
});

test("wiring retires each plugin's boundary rules once boundaries is on", (t) => {
  const retired = [
    "packages/oxlint-plugin-web/rules/module-boundaries.ts",
    "packages/oxlint-plugin-web/rules/module-boundaries.test.ts",
    "packages/oxlint-plugin-web/rules/no-restricted-import-paths.ts",
    "packages/oxlint-plugin-web/rules/no-restricted-import-paths.test.ts",
  ];
  const wiring = (config) => {
    const cwd = tempRepo(t);
    write(cwd, { ...WIRED, ".standard/config.json": config, ...Object.fromEntries(retired.map((path) => [path, "export {};\n"])) });
    git(cwd, "add", "-A");
    return standard(cwd, ["check", "wiring"]).stdout;
  };
  assert.deepEqual(
    wiring({}).split("\n").filter((line) => line.includes("boundaries")),
    retired.map((path) => `wiring: ${path}: Delete ${path}, which the boundaries check replaces.`),
  );
  assert.doesNotMatch(wiring({ pending: ["boundaries"] }), /boundaries/);
});

test("the config rejects a malformed or escaping glob and names it", (t) => {
  const cases = [
    [{ forbid: [{ files: ["src/["], imports: ["b/**"], fix: "Do it." }] }, '.standard/config.json boundaries.forbid[0].files has the glob "src/[", which opens a [ it never closes. Fix it so it matches the files you mean.\n'],
    [{ modules: [{ folders: ["src/{a,b"], entries: ["index"] }] }, '.standard/config.json boundaries.modules[0].folders has the glob "src/{a,b", which opens a { it never closes. Fix it so it matches the files you mean.\n'],
    [{ modules: [{ folders: ["src/*"], entries: ["index"], except: ["../other/**"] }] }, '.standard/config.json boundaries.modules[0].except has the glob "../other/**", which is not a path relative to the repository root. Fix it so it matches the files you mean.\n'],
  ];
  for (const [boundaries, message] of cases) {
    const { stderr, status } = standard(tempRepo(t, { boundaries }), ["check"]);
    assert.equal(stderr, `standard: ${message}`);
    assert.equal(status, 1);
  }
});

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries resolves as TypeScript ${major} does: the require condition in a .cts file and node under nodenext pick the targets forbid matches`, (t) => {
    const forbid = [{ files: ["apps/node/**"], imports: ["apps/api/src/{required,node}.ts"], fix: "Use the other build." }];
    const cwd = repoWith(t, {
      "apps/api/package.json": { name: "api", exports: { "./condition": { require: "./src/required.ts", import: "./src/imported.ts" }, "./runtime": { node: "./src/node.ts", default: "./src/default.ts" }, "./logo.png": "./logo.png" } },
      "apps/api/logo.png": "png",
      "apps/api/src/required.ts": "export const value = 1;\n",
      "apps/api/src/imported.ts": "export const value = 1;\n",
      "apps/api/src/node.ts": "export const value = 1;\n",
      "apps/api/src/default.ts": "export const value = 1;\n",
      "apps/node/package.json": { name: "node-app", dependencies: { api: "workspace:*" } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/src/condition.cts": 'import { value } from "api/condition";\nexport const a = value;\n',
      "apps/node/src/runtime.mts": 'import { value } from "api/runtime";\nexport const b = value;\n',
      "apps/node/src/declaration.d.ts": "export declare const value: number;\n",
      "apps/node/src/uses-declaration.mts": 'import type { value } from "./declaration.js";\nexport type V = typeof value;\n',
      "apps/node/src/logo.mts": 'import logo from "api/logo.png";\nexport const src = logo;\n',
    }, { forbid });
    mkdirSync(join(cwd, "apps/node/node_modules"));
    symlinkSync(join(cwd, "apps/api"), join(cwd, "apps/node/node_modules/api"));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    assert.deepEqual(findings(cwd), {
      lines: [
        'boundaries: apps/node/src/condition.cts imports api/condition: apps/api/src/required.ts matches boundaries.forbid "apps/api/src/{required,node}.ts". Use the other build.',
        'boundaries: apps/node/src/runtime.mts imports api/runtime: apps/api/src/node.ts matches boundaries.forbid "apps/api/src/{required,node}.ts". Use the other build.',
      ],
      status: 1,
    });
  });
}

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries matches forbid against the nested exports target TypeScript ${major} takes past a missing one`, (t) => {
    const forbid = [{ files: ["apps/node/**"], imports: ["apps/api/src/required.ts"], fix: "Use the public entry." }];
    const cwd = repoWith(t, {
      "apps/api/package.json": { name: "api", type: "module", exports: { "./nested": { types: { import: "./missing.d.ts", default: "./src/required.ts" }, import: "./src/other.ts" } } },
      "apps/api/src/required.ts": 'export const value: "required" = "required";\n',
      "apps/api/src/other.ts": 'export const value: "other" = "other";\n',
      "apps/node/package.json": { name: "node-app", dependencies: { api: "workspace:*" } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/src/nested.mts": 'import { value } from "api/nested";\nexport const a: "required" = value;\n',
    }, { forbid });
    mkdirSync(join(cwd, "apps/node/node_modules"));
    symlinkSync(join(cwd, "apps/api"), join(cwd, "apps/node/node_modules/api"));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    assert.deepEqual(findings(cwd), {
      lines: ['boundaries: apps/node/src/nested.mts imports api/nested: apps/api/src/required.ts matches boundaries.forbid "apps/api/src/required.ts". Use the public entry.'],
      status: 1,
    });
  });
}

for (const [major, compiler] of Object.entries(COMPILERS)) {
  test(`boundaries matches forbid against the declaration TypeScript ${major} routes to by version`, (t) => {
    const forbid = [{ files: ["apps/node/**"], imports: ["packages/*/legacy/**", "packages/routed/modern/**"], fix: "Use the supported entry." }];
    const cwd = repoWith(t, {
      "packages/versioned/package.json": { name: "versioned", type: "module", exports: { "types@>=5.2": "./modern/index.d.ts", types: "./legacy/index.d.ts", default: "./index.js" } },
      "packages/versioned/modern/index.d.ts": 'export declare const value: "modern";\n',
      "packages/versioned/legacy/index.d.ts": 'export declare const value: "legacy";\n',
      "packages/routed/package.json": { name: "routed", type: "module", types: "./index.d.ts", typesVersions: { ">=5.2": { "*": ["modern/*"] } } },
      "packages/routed/index.d.ts": 'export declare const value: "legacy";\n',
      "packages/routed/modern/index.d.ts": 'export declare const value: "modern";\n',
      "apps/node/package.json": { name: "node-app", type: "module", dependencies: { versioned: "workspace:*", routed: "workspace:*" } },
      "apps/node/tsconfig.json": { compilerOptions: { module: "nodenext", strict: true } },
      "apps/node/src/versioned.mts": 'import { value } from "versioned";\nexport const v: "modern" = value;\n',
      "apps/node/src/routed.mts": 'import { value } from "routed";\nexport const v: "modern" = value;\n',
    }, { forbid });
    mkdirSync(join(cwd, "apps/node/node_modules"));
    for (const name of ["versioned", "routed"]) symlinkSync(join(cwd, "packages", name), join(cwd, `apps/node/node_modules/${name}`));
    symlinkSync(compiler, join(cwd, "apps/node/node_modules/typescript"));
    assert.deepEqual(findings(cwd), {
      lines: ['boundaries: apps/node/src/routed.mts imports routed: packages/routed/modern/index.d.ts matches boundaries.forbid "packages/*/legacy/**, packages/routed/modern/**". Use the supported entry.'],
      status: 1,
    });
  });
}
