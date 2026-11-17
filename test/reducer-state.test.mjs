import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parseSync } from "oxc-parser";

import { reducerStates } from "../src/checks/support/reducer-state.mjs";
import { tempDir, write } from "./helpers.mjs";

const COMPILERS = { 7: join(import.meta.dirname, "../node_modules/typescript"), 6: join(import.meta.dirname, "../node_modules/typescript-6") };

const REACT = [
  "export function useReducer<S, A extends unknown[]>(reducer: (state: S, ...args: A) => S, initial: S): [S, (...args: A) => void];",
  "export function useState<S>(initial: S): [S, (next: S) => void];",
  "",
].join("\n");

const TYPES = [
  'type Good = { status: "idle" } | { status: "loading" } | { status: "done"; data: string };',
  'type Bad = { status: "idle" | "done"; data?: string };',
  'type Gen<T> = { status: "idle" } | { status: "ok"; value: T };',
  "const good = (state: Good, next: Good) => next;",
  "",
].join("\n");

const source = (body, imports = 'import { useReducer } from "react";') => `${imports}\n${TYPES}${body}\n`;

const FILES = {
  "node_modules/react/package.json": { name: "react", version: "19.0.0", types: "index.d.ts" },
  "node_modules/react/index.d.ts": REACT,
  "tsconfig.json": { compilerOptions: { strict: true, jsx: "preserve", module: "preserve", target: "esnext", noEmit: true }, include: ["src"] },
  "src/union.tsx": source('export function A() { return useReducer(good, { status: "idle" }); }'),
  "src/object.tsx": source('export function A() { return useReducer((state: Bad, next: Bad) => next, { status: "idle" }); }'),
  "src/number.tsx": source("export function A() { return useReducer((state: number, next: number) => next, 0); }"),
  "src/generic.tsx": source('function gen<T>(state: Gen<T>, next: Gen<T>) { return next; }\nexport function A() { return useReducer(gen<string>, { status: "idle" }); }'),
  "src/pattern.tsx": source('export function A() { const [{ status }, send] = useReducer(good, { status: "idle" }); return [status, send]; }'),
  "src/namespace.tsx": source('export function A() { return React.useReducer(good, { status: "idle" }); }', 'import * as React from "react";'),
  "src/parameter.tsx": source("export function useMachine<S>(reducer: (state: S, next: S) => S, initial: S) { return useReducer(reducer, initial); }"),
  "src/any.tsx": source("export function A() { return useReducer((state: any, next: any) => next, {}); }"),
  "src/thai.tsx": source('const label = "สวัสดี 😀";\nexport function A() { return [label, useReducer(good, { status: "idle" })]; }'),
  "src/two.tsx": source('export function A() { return [useReducer(good, { status: "idle" }), useReducer((state: number, next: number) => next, 0)]; }'),
  "outside/stray.tsx": source('export function A() { return useReducer(good, { status: "idle" }); }'),
};

function sitesOf(file, text) {
  const sites = [];
  JSON.stringify(parseSync(file, text).program, (_, node) => {
    const callee = node?.type === "CallExpression" ? node.callee : null;
    if ((callee?.property ?? callee)?.name === "useReducer") sites.push({ file, end: node.end });
    return node;
  });
  return sites.toSorted((a, b) => a.end - b.end);
}

async function read(t, compiler, files = FILES) {
  const root = tempDir(t, "reducer");
  write(root, files);
  if (compiler !== null) {
    mkdirSync(join(root, "node_modules"), { recursive: true });
    symlinkSync(COMPILERS[compiler], join(root, "node_modules/typescript"));
  }
  const sites = Object.entries(files).flatMap(([file, text]) => (file.endsWith(".tsx") ? sitesOf(file, text) : []));
  const shapes = await reducerStates(root, sites);
  assert.equal(shapes.size, sites.length);
  return (file) => sites.filter((site) => site.file === file).map((site) => shapes.get(site));
}

const GOOD = {
  exact: true,
  members: [
    { text: '{ status: "idle"; }', status: "idle" },
    { text: '{ status: "loading"; }', status: "loading" },
    { text: '{ status: "done"; data: string; }', status: "done" },
  ],
};
const NUMBER = { exact: true, members: [{ text: "number", status: null }] };

for (const compiler of [7, 6]) {
  test(`reducerStates reads each state with TypeScript ${compiler}`, async (t) => {
    const shapes = await read(t, compiler);
    assert.deepEqual(shapes("src/union.tsx"), [GOOD]);
    assert.deepEqual(shapes("src/object.tsx"), [{ exact: true, members: [{ text: "Bad", status: null }] }]);
    assert.deepEqual(shapes("src/number.tsx"), [NUMBER]);
    assert.deepEqual(shapes("src/generic.tsx"), [
      {
        exact: true,
        members: [
          { text: '{ status: "idle"; }', status: "idle" },
          { text: '{ status: "ok"; value: string; }', status: "ok" },
        ],
      },
    ]);
    assert.deepEqual(shapes("src/pattern.tsx"), [GOOD]);
    assert.deepEqual(shapes("src/namespace.tsx"), [GOOD]);
    assert.deepEqual(shapes("src/thai.tsx"), [GOOD]);
    assert.deepEqual(shapes("src/two.tsx"), [GOOD, NUMBER]);
  });

  test(`reducerStates fails closed with TypeScript ${compiler} when it cannot read a state`, async (t) => {
    const shapes = await read(t, compiler);
    assert.deepEqual(shapes("src/parameter.tsx"), [
      { exact: false, reason: "has a state of type parameter S", fix: "Call useReducer where the state type is concrete, or give the hook a concrete state union." },
    ]);
    assert.deepEqual(shapes("src/any.tsx"), [{ exact: false, reason: "has a state of type any", fix: "Give the reducer's state parameter a concrete union type." }]);
    assert.deepEqual(shapes("outside/stray.tsx"), [{ exact: false, reason: "is in no TypeScript project", fix: "Add outside/stray.tsx to the include of tsconfig.json." }]);
  });

  test(`reducerStates fails closed with TypeScript ${compiler} on an offset that ends no call and on missing react types`, async (t) => {
    const root = tempDir(t, "reducer");
    write(root, { "tsconfig.json": FILES["tsconfig.json"], "src/union.tsx": FILES["src/union.tsx"] });
    mkdirSync(join(root, "node_modules"));
    symlinkSync(COMPILERS[compiler], join(root, "node_modules/typescript"));
    const [real] = sitesOf("src/union.tsx", FILES["src/union.tsx"]);
    const shifted = { file: "src/union.tsx", end: real.end - 1 };
    const shapes = await reducerStates(root, [real, shifted]);
    assert.deepEqual(shapes.get(real), {
      exact: false,
      reason: "has no return type that TypeScript can resolve",
      fix: "Run the typecheck and fix what it reports at this call, such as missing types for react.",
    });
    assert.deepEqual(shapes.get(shifted), { exact: false, reason: "is not a call where TypeScript parses the file", fix: "Fix the syntax errors in src/union.tsx and run the check again." });
  });
}

test("reducerStates fails closed when no typescript resolves from the file", async (t) => {
  const shapes = await read(t, null);
  assert.deepEqual(shapes("src/union.tsx"), [
    {
      exact: false,
      reason: "is in a package that resolves no typescript",
      fix: "Add typescript to the devDependencies of the package that holds src/union.tsx and run pnpm install, so the check reads it with the repository's own compiler.",
    },
  ]);
});

test("reducerStates fails closed when a file has no tsconfig.json above it", async (t) => {
  const { "tsconfig.json": tsconfig, ...files } = FILES;
  const shapes = await read(t, 7, { ...files, "src/tsconfig.json": { ...tsconfig, include: ["."] } });
  assert.equal(shapes("src/union.tsx")[0].exact, true);
  assert.deepEqual(shapes("outside/stray.tsx"), [{ exact: false, reason: "is in no TypeScript project", fix: "Add a tsconfig.json whose include covers outside/stray.tsx." }]);
});

test("reducerStates reads sites from two TypeScript installs in one run", async (t) => {
  const root = tempDir(t, "reducer");
  const app = (name) => Object.fromEntries(["node_modules/react/package.json", "node_modules/react/index.d.ts", "tsconfig.json", "src/union.tsx"].map((file) => [`${name}/${file}`, FILES[file]]));
  write(root, { ...app("new"), ...app("old") });
  symlinkSync(COMPILERS[7], join(root, "new/node_modules/typescript"));
  symlinkSync(COMPILERS[6], join(root, "old/node_modules/typescript"));
  const sites = ["new", "old"].map((name) => sitesOf(`${name}/src/union.tsx`, FILES["src/union.tsx"])[0]);
  assert.deepEqual([...(await reducerStates(root, sites)).values()], [GOOD, GOOD]);
});

test("reducerStates fails closed when the TypeScript install cannot be loaded", async (t) => {
  const root = tempDir(t, "reducer");
  write(root, { "node_modules/typescript/package.json": { name: "typescript", version: "7.0.2" }, "src/union.tsx": FILES["src/union.tsx"] });
  const sites = sitesOf("src/union.tsx", FILES["src/union.tsx"]);
  const [shape] = (await reducerStates(root, sites)).values();
  assert.equal(shape.exact, false);
  assert.match(shape.reason, /^made TypeScript fail with "Cannot find module /);
  assert.equal(shape.fix, "Run the typecheck and fix what it reports, then run the check again.");
});
