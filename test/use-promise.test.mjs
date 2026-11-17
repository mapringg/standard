import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const APP = {
  "apps/web/package.json": { dependencies: { next: "16.0.0", react: "19.0.0" } },
  "apps/web/tsconfig.json": { compilerOptions: { module: "esnext", moduleResolution: "bundler", paths: { "@/*": ["./src/*"] } } },
  "apps/web/src/lib/cached.ts": "export const getUser = cache(async (id: string) => id);\n",
  "apps/web/src/lib/index.ts": 'export * from "./cached";\n',
  "apps/web/src/api/users.ts": 'export const getUser = (id: string) => fetch(`/users/${id}`);\nexport const shared = Promise.resolve(1);\n',
  "apps/web/src/theme.ts": 'import { createContext } from "react";\nconst Theme = createContext("light");\nexport { Theme as ThemeContext };\n',
};
const CACHED = { "cached-modules": ["apps/web/src/lib/cached.ts"] };
const CREATED = "A new promise on each render suspends forever. Take the promise as a prop from a Server Component, or call a function from a module that cached-modules in .standard/config.json lists.";
const UNTRACED = "The check fails closed here, since a promise made during render suspends forever. Read a prop of an exported component or hook, a value made once at module level, or a call to a function from a module that cached-modules in .standard/config.json lists. Where a promise reaches use() through a function or list the check cannot follow, call use() in the component that takes the promise as a prop.";
/** TypeScript 7's API server prints this when the check closes it, after the run has finished. */
const TSGO_SHUTDOWN = /^context canceled\n/m;
const NO_BASELINE = "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.";

function repoWith(t, config, files) {
  const cwd = tempRepo(t, config);
  write(cwd, { ...APP, ...files });
  mkdirSync(join(cwd, "node_modules"), { recursive: true });
  symlinkSync(join(import.meta.dirname, "../node_modules/typescript"), join(cwd, "node_modules/typescript"));
  git(cwd, "add", "-A");
  return cwd;
}

function check(t, config, files, ...flags) {
  const cwd = repoWith(t, config, files);
  const run = standard(cwd, ["check", "use-promise", ...flags]);
  return { cwd, ...run, stderr: run.stderr.replace(TSGO_SHUTDOWN, "") };
}

function fails(t, config, files, ...fixes) {
  const { stdout, stderr, status } = check(t, config, files);
  assert.equal(stderr, "");
  assert.equal(stdout, [`use-promise: ${fixes.length} new findings.`, ...fixes.map((fix) => `  ${fix}`), NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
}

function passes(t, config, files) {
  const { stdout, stderr, status } = check(t, config, files);
  assert.deepEqual({ stdout, stderr, status }, { stdout: "use-promise: OK\n", stderr: "", status: 0 });
}

const created = (path, lines) => `${path} passes React's use() a promise it creates while it renders, on ${lines}. ${CREATED}`;
const untraced = (path, lines) => `${path} passes React's use() a value whose origin the check cannot trace, on ${lines}. ${UNTRACED}`;

test("use-promise fails a promise a client render creates, through any binding of use and any local that holds it", (t) => {
  fails(
    t,
    CACHED,
    {
      "apps/web/src/view.tsx": [
        '"use client";',
        'import * as React from "react";',
        'import { use as read } from "react";',
        'import { getUser } from "@/api/users";',
        "export function View({ id }: { id: string }) {",
        '  const user = React.use(fetch("/a"));',
        "  const pending = getUser(id);",
        "  const alias = pending;",
        "  const posts = read(alias);",
        "  const later = read(new Promise((done) => done(id)));",
        "  return [user, posts, later];",
        "}",
        "",
      ].join("\n"),
      "apps/web/src/branch.tsx": '"use client";\nimport { use } from "react";\nexport const View = (props) => use(props.ready ? props.data : fetch("/a"));\n',
      "apps/web/src/shared.tsx": '"use client";\nimport { use } from "react";\nimport { shared } from "@/api/missing";\nexport const View = () => use(shared);\n',
    },
    created("apps/web/src/branch.tsx", "line 3"),
    untraced("apps/web/src/shared.tsx", "line 4"),
    created("apps/web/src/view.tsx", "lines 6, 9, 10"),
  );
});

test("use-promise passes a prop, a parameter, a cached function's result and a context, and a server file", (t) => {
  passes(t, CACHED, {
    "apps/web/src/view.tsx": [
      '"use client";',
      'import React, { createContext, use } from "react";',
      'import { getUser } from "@/lib/cached";',
      'import { getUser as viaBarrel } from "@/lib";',
      'import { ThemeContext } from "./theme";',
      "const Local = React.createContext(0);",
      "export function View(props: { data: Promise<string>; id: string }) {",
      "  const { data } = props;",
      "  const user = getUser(props.id);",
      "  return [use(props?.data), use(data), use(user), use(viaBarrel(props.id)), use(ThemeContext), use(Local), use(props.id ? data : props.data)];",
      "}",
      "export function Row({ item }: { item: Promise<string> }) {",
      "  return use(item);",
      "}",
      "export const Made = createContext(null);",
      "",
    ].join("\n"),
    "apps/web/src/server.tsx": 'import { use } from "react";\nexport const View = () => use(fetch("/a"));\n',
    "apps/web/src/view.test.tsx": '"use client";\nimport { use } from "react";\nexport const View = () => use(fetch("/a"));\n',
  });
});

test("use-promise fails a cached-looking function from a module cached-modules does not list", (t) => {
  fails(
    t,
    {},
    { "apps/web/src/view.tsx": '"use client";\nimport { use } from "react";\nimport { getUser } from "@/lib/cached";\nexport const View = ({ id }) => use(getUser(id));\n' },
    created("apps/web/src/view.tsx", "line 4"),
  );
});

test("use-promise refuses a cached-modules value that is not a list of globs", (t) => {
  const { stdout, stderr, status } = check(t, { "cached-modules": "apps/web/src/lib/**" }, {});
  assert.deepEqual({ stdout, stderr: stderr.trim(), status }, { stdout: "", stderr: "standard: .standard/config.json cached-modules must be a list of non-empty strings.", status: 1 });
});

test("use-promise keeps a baseline that records today's calls and fails a new one", (t) => {
  const site = '"use client";\nimport { use } from "react";\nexport const View = () => use(fetch("/a"));\n';
  const { cwd } = check(t, {}, { "apps/web/src/a.tsx": site }, "--init");
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/use-promise.json"), "utf8")), { "use-promise": ["apps/web/src/a.tsx use created"] });
  write(cwd, { "apps/web/src/b.tsx": site });
  git(cwd, "add", "-A");
  const { stdout, status } = standard(cwd, ["check", "use-promise"]);
  assert.match(stdout, /^use-promise: 1 new findings\.\n {2}apps\/web\/src\/b\.tsx passes React's use\(\) a promise/);
  assert.equal(status, 1);
});

test("use-promise fails a promise a client render passes to an in-file component or hook, at the call, and a parameter it cannot trace", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/view.tsx": [
        '"use client";',
        'import { use } from "react";',
        'import { getUser } from "@/api/users";',
        "function Child({ p }: { p: Promise<string> }) {",
        "  return use(p);",
        "}",
        "function useRead(p: Promise<string>) {",
        "  return use(p);",
        "}",
        "export function View({ id }: { id: string }) {",
        "  const read = useRead(getUser(id));",
        '  return [read, <Child p={getUser(id)} key="a" />];',
        "}",
        "",
      ].join("\n"),
      "apps/web/src/list.tsx": [
        '"use client";',
        'import { use } from "react";',
        "function Row(item: Promise<string>) {",
        "  return use(item);",
        "}",
        "export function useData(p: Promise<string>) {",
        "  return use(p);",
        "}",
        "function Orphan({ p }: { p: Promise<string> }) {",
        "  return use(p);",
        "}",
        "export const List = ({ items }: { items: Promise<string> }) => [useData(items), Row(items), [items].map(Row)];",
        "",
      ].join("\n"),
    },
    untraced("apps/web/src/list.tsx", "lines 4, 10"),
    created("apps/web/src/view.tsx", "lines 11, 12"),
  );
});

test("use-promise passes a server prop that a client component forwards to an in-file component or hook", (t) => {
  passes(t, {}, {
    "apps/web/src/view.tsx": [
      '"use client";',
      'import { use } from "react";',
      "function Child({ p }: { p: Promise<string>; onPick: () => unknown }) {",
      "  return use(p);",
      "}",
      "function useRead(p: Promise<string>) {",
      "  return use(p);",
      "}",
      "function Wrapped(props: { p: Promise<string>; label: string; onPick: () => unknown }) {",
      "  return use(props.p);",
      "}",
      "function useOpts(opts: { p: Promise<string> }) {",
      "  return use(opts.p);",
      "}",
      "function Mid(props: { p: Promise<string>; onPick: () => unknown }) {",
      "  const { p } = props;",
      "  return [useOpts(props), use(p)];",
      "}",
      "export function View({ p, q }: { p: Promise<string>; q: Promise<string> }) {",
      '  return [useRead(q), <Child p={p} onPick={() => q} />, <Wrapped p={p} label="x" onPick={() => q} />, <Mid p={p} onPick={() => q} />];',
      "}",
      "",
    ].join("\n"),
    "apps/web/src/page.tsx": '"use client";\nimport { use } from "react";\nexport default function ({ data }: { data: Promise<string> }) {\n  return use(data);\n}\n',
  });
});

test("use-promise passes a promise made once at module level, in the file, in a function that stores it there, or imported", (t) => {
  passes(t, {}, {
    "apps/web/src/view.tsx": [
      '"use client";',
      'import { use } from "react";',
      'import { getUser, shared } from "@/api/users";',
      "const me = getUser(\"me\");",
      "let load: Promise<string> | undefined;",
      "function preload() {",
      "  if (load) return load;",
      "  const next = getUser(\"you\");",
      "  load = next;",
      "  return next;",
      "}",
      "let user: Promise<string> | undefined;",
      "function guarded() {",
      "  if (user != null) return user;",
      "  user = getUser(\"them\");",
      "  return user;",
      "}",
      "let lazy: Promise<string> | undefined;",
      "const once = () => (lazy ??= getUser(\"us\"));",
      "function mine() {",
      "  return me;",
      "}",
      "export function View() {",
      "  return [use(me), use(shared), use(preload()), use(guarded()), use(once()), use(mine())];",
      "}",
      "",
    ].join("\n"),
  });
});

test("use-promise fails a function that returns a promise it does not keep at module level", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/view.tsx": [
        '"use client";',
        'import { use } from "react";',
        'import { getUser } from "@/api/users";',
        "let load: Promise<string> | undefined;",
        "function fresh() {",
        "  const next = getUser(\"me\");",
        "  return next;",
        "}",
        "function chained() {",
        "  load = getUser(\"me\");",
        "  return load.then((user) => user);",
        "}",
        "let current: Promise<string> | undefined;",
        "function stored(id: string) {",
        "  current = getUser(id);",
        "  return current;",
        "}",
        "let last: Promise<string> | undefined;",
        "function unguarded() {",
        "  const next = getUser(\"me\");",
        "  last = next;",
        "  return next;",
        "}",
        "let late: Promise<string> | undefined;",
        "function guardedLate() {",
        "  late = getUser(\"me\");",
        "  if (late) return late;",
        "  return late;",
        "}",
        "export function View() {",
        "  function inner() {",
        "    if (load) return load;",
        "    load = getUser(\"me\");",
        "    return load;",
        "  }",
        "  return [",
        "    use(fresh()),",
        "    use(chained()),",
        "    use(stored(\"me\")),",
        "    use(unguarded()),",
        "    use(guardedLate()),",
        "    use(inner()),",
        "  ];",
        "}",
        "",
      ].join("\n"),
      "apps/web/src/guards.tsx": [
        '"use client";',
        'import { use } from "react";',
        'import { getUser } from "@/api/users";',
        "let ready = false;",
        "let load: Promise<string> | undefined;",
        "function other() {",
        "  if (ready) return load;",
        "  load = getUser(\"me\");",
        "  return load;",
        "}",
        "let kept: Promise<string> | undefined;",
        "function otherwise() {",
        "  if (kept) return kept;",
        "  else kept = getUser(\"me\");",
        "  return kept;",
        "}",
        "function local() {",
        "  let box: Promise<string> | undefined;",
        "  return (box ??= getUser(\"me\"));",
        "}",
        "export const View = () => [",
        "  use(other()),",
        "  use(otherwise()),",
        "  use(local()),",
        "];",
        "",
      ].join("\n"),
    },
    created("apps/web/src/guards.tsx", "lines 22, 23, 24"),
    created("apps/web/src/view.tsx", "lines 37, 38, 39, 40, 41, 42"),
  );
});

test("use-promise fails a module promise that another assignment anywhere in the module can clear or replace", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/view.tsx": [
        '"use client";',
        'import { use } from "react";',
        'import { getUser } from "@/api/users";',
        "let load: Promise<string> | undefined;",
        "function settled() {",
        "  if (load) return load;",
        "  load = getUser(\"me\").finally(() => {",
        "    load = undefined;",
        "  });",
        "  return load;",
        "}",
        "let lazy: Promise<string> | undefined;",
        "const once = () => (lazy ??= getUser(\"us\"));",
        "function clear() {",
        "  lazy = undefined;",
        "}",
        "let user: Promise<string> | undefined;",
        "function guarded() {",
        "  if (user) return user;",
        "  user = getUser(\"them\");",
        "  return user;",
        "}",
        "let cur: Promise<string> | undefined;",
        "function start(id: string) {",
        "  cur = getUser(id);",
        "}",
        "function current() {",
        "  return cur;",
        "}",
        "let last = Promise.resolve(\"none\");",
        "export function View({ id }: { id: string }) {",
        "  clear();",
        "  user = undefined;",
        "  start(id);",
        "  last = getUser(id);",
        "  return [",
        "    use(settled()),",
        "    use(once()),",
        "    use(guarded()),",
        "    use(current()),",
        "    use(last),",
        "  ];",
        "}",
        "",
      ].join("\n"),
    },
    created("apps/web/src/view.tsx", "lines 37, 38, 39, 40"),
    untraced("apps/web/src/view.tsx", "line 41"),
  );
});

test("use-promise passes a guarded module promise whose own rejection handler clears it while it still holds that promise", (t) => {
  passes(t, {}, {
    "apps/web/src/view.tsx": [
      '"use client";',
      'import { use } from "react";',
      'import { getUser } from "@/api/users";',
      "let load: Promise<string> | undefined;",
      "function both() {",
      "  if (load) return load;",
      "  const next = getUser(\"me\");",
      "  next.then(",
      "    (user) => user,",
      "    () => {",
      "      if (load === next) load = undefined;",
      "    },",
      "  );",
      "  load = next;",
      "  return next;",
      "}",
      "let user: Promise<string> | undefined;",
      "function caught() {",
      "  if (user !== undefined) return user;",
      "  const next = getUser(\"them\");",
      "  next.catch(() => {",
      "    if (next === user) {",
      "      user = null!;",
      "    }",
      "  });",
      "  user = next;",
      "  return user;",
      "}",
      "export function View() {",
      "  return [use(both()), use(caught())];",
      "}",
      "",
    ].join("\n"),
  });
});

test("use-promise fails a module promise cleared on fulfillment, without an identity check, or from another promise's handler", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/view.tsx": [
        '"use client";',
        'import { use } from "react";',
        'import { getUser } from "@/api/users";',
        "let a: Promise<string> | undefined;",
        "function fulfilled() {",
        "  if (a) return a;",
        "  const next = getUser(\"a\");",
        "  next.then(() => {",
        "    if (a === next) a = undefined;",
        "  });",
        "  a = next;",
        "  return next;",
        "}",
        "let b: Promise<string> | undefined;",
        "function unchecked() {",
        "  if (b) return b;",
        "  const next = getUser(\"b\");",
        "  next.catch(() => {",
        "    b = undefined;",
        "  });",
        "  b = next;",
        "  return next;",
        "}",
        "let c: Promise<string> | undefined;",
        "function other() {",
        "  if (c) return c;",
        "  const next = getUser(\"c\");",
        "  const side = getUser(\"side\");",
        "  side.catch(() => {",
        "    if (c === next) c = undefined;",
        "  });",
        "  c = next;",
        "  return next;",
        "}",
        "let d: Promise<string> | undefined;",
        "function chained() {",
        "  if (d) return d;",
        "  d = getUser(\"d\").catch(() => {",
        "    d = undefined;",
        "    return \"\";",
        "  });",
        "  return d;",
        "}",
        "export function View() {",
        "  return [use(fulfilled()), use(unchecked()), use(other()), use(chained())];",
        "}",
        "",
      ].join("\n"),
    },
    created("apps/web/src/view.tsx", "line 45"),
  );
});

test("use-promise passes a prop of an exported hook or of a memo or forwardRef component, a list callback over one, and a missing argument", (t) => {
  passes(t, {}, {
    "apps/web/src/view.tsx": [
      '"use client";',
      'import * as React from "react";',
      'import { use, memo, forwardRef } from "react";',
      "function Row({ p }: { p: Promise<string> }) {",
      "  return use(p);",
      "}",
      "function useMaybe(p?: Promise<string>) {",
      "  return p ? use(p) : null;",
      "}",
      "export function useRead(p: Promise<string>) {",
      "  return use(p);",
      "}",
      "export function useUserName({ user }: { user: Promise<string> }) {",
      "  return use(user);",
      "}",
      "export const Card = memo(function Card({ p }: { p: Promise<string> }) {",
      "  return use(p);",
      "});",
      "export const Field = forwardRef(function Field({ p }: { p: Promise<string> }, ref) {",
      "  return [use(p), ref];",
      "});",
      "export const Panel = React.memo(({ p }: { p: Promise<string> }) => use(p));",
      "export function List({ items }: { items: { p: Promise<string> }[] }) {",
      '  return [items.map((item) => <Row p={item.p} key="a" />), items.flatMap(({ p }) => [<Row p={p} key="b" />]), useMaybe()];',
      "}",
      "",
    ].join("\n"),
    "apps/web/src/page.tsx": '"use client";\nimport { memo, use } from "react";\nexport default memo(function Page({ data }: { data: Promise<string> }) {\n  return use(data);\n});\n',
  });
});

test("use-promise fails a promise the file passes to an exported component or hook, a default, children and an object in a local", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/view.tsx": [
        '"use client";',
        'import { use, memo } from "react";',
        'import { getUser } from "@/api/users";',
        "export function Child({ p }: { p: Promise<string> }) { return use(p); }",
        "export function useRead(p: Promise<string>) { return use(p); }",
        "export const Card = memo(function Card({ p }: { p: Promise<string> }) { return use(p); });",
        'function Fallback({ p = getUser("me") }: { p?: Promise<string> }) { return use(p); }',
        'export function useDefault(p = getUser("me")) { return use(p); }',
        "function Kids({ children }: { children: Promise<string> }) { return use(children); }",
        "function useOpts(o: { p: Promise<string> }) { return use(o.p); }",
        "const read = useRead;",
        "export function View({ id }: { id: string }) {",
        "  const o = { p: getUser(id) };",
        "  return [",
        '    <Child p={getUser(id)} key="a" />,',
        "    useRead(getUser(id)),",
        '    <Card p={getUser(id)} key="b" />,',
        '    <Fallback key="c" />,',
        '    <Kids key="d">{getUser(id)}</Kids>,',
        "    useOpts(o),",
        "    read(getUser(id)),",
        "  ];",
        "}",
        "",
      ].join("\n"),
      "apps/web/src/list.tsx": [
        '"use client";',
        'import { use } from "react";',
        'import { getUser } from "@/api/users";',
        "function Row({ p }: { p: Promise<string> }) {",
        "  return use(p);",
        "}",
        "export const View = ({ ids }: { ids: string[] }) => ids.map(getUser).map((p) => <Row p={p} key=\"a\" />);",
        "",
      ].join("\n"),
    },
    created("apps/web/src/list.tsx", "line 7"),
    created("apps/web/src/view.tsx", "lines 7, 8, 15, 16, 17, 19, 20, 21"),
  );
});

test("use-promise fails closed on a form it cannot read, an import it cannot resolve or trace, and a cycle", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/sequence.tsx": '"use client";\nimport { use } from "react";\nexport const View = (props) => use((0, props.data));\n',
      "apps/web/src/missing.tsx": '"use client";\nimport { use } from "react";\nimport { data } from "@/api/missing";\nexport const View = () => use(data);\n',
      "apps/web/src/function.tsx": '"use client";\nimport { use } from "react";\nimport { getUser } from "@/api/users";\nexport const View = () => use(getUser);\n',
      "apps/web/src/local.tsx": '"use client";\nimport { use } from "react";\nfunction load() {\n  return 1;\n}\nconst make = () => 1;\nexport const View = () => [use(load),\n  use(make)];\n',
      "apps/web/src/cycle.tsx": '"use client";\nimport { use } from "react";\nexport function View() {\n  let a = b;\n  let b = a;\n  return use(a);\n}\n',
      "apps/web/src/lower.tsx": '"use client";\nimport { use } from "react";\nimport { getUser } from "@/api/users";\nexport function read(p: Promise<string>) {\n  return use(p);\n}\nexport const View = ({ id }: { id: string }) => read(getUser(id));\n',
      "apps/web/src/tree.tsx": [
        '"use client";',
        'import { use } from "react";',
        "function Tree({ p }: { p: Promise<string> }) {",
        "  return [use(p), <Tree p={p} />];",
        "}",
        "export const View = ({ p }: { p: Promise<string> }) => <Tree p={p} />;",
        "",
      ].join("\n"),
      "apps/web/src/spread.tsx": [
        '"use client";',
        'import { use } from "react";',
        "function useSecond(a: unknown, b: Promise<string>) {",
        "  return use(b);",
        "}",
        "function useOpts(opts: { p: Promise<string> }) {",
        "  return use(opts.p);",
        "}",
        "function Two(a: unknown, b: Promise<string>) {",
        "  return use(b);",
        "}",
        "export function View({ p }: { p: Promise<string> }) {",
        "  return [",
        "    useSecond(...[p, p]),",
        "    useOpts({ ...{ p } }),",
        "    <Two />,",
        "  ];",
        "}",
        "",
      ].join("\n"),
    },
    untraced("apps/web/src/cycle.tsx", "line 6"),
    untraced("apps/web/src/function.tsx", "line 4"),
    untraced("apps/web/src/local.tsx", "lines 7, 8"),
    untraced("apps/web/src/lower.tsx", "line 5"),
    untraced("apps/web/src/missing.tsx", "line 4"),
    untraced("apps/web/src/sequence.tsx", "line 3"),
    untraced("apps/web/src/spread.tsx", "lines 14, 15, 16"),
    untraced("apps/web/src/tree.tsx", "line 4"),
  );
});

test("use-promise fails a created promise beside a prop or under a member, a spread it cannot read, and a function that does not keep it", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/view.tsx": [
        '"use client";',
        'import { use } from "react";',
        'import { getUser } from "@/api/users";',
        "let load: Promise<string> | undefined;",
        "function Child({ p }: { p: Promise<string> }) {",
        "  return use(p);",
        "}",
        "function shadow() {",
        "  let load = getUser(\"me\");",
        "  return load;",
        "}",
        "function either() {",
        "  if (load) return load;",
        "  return getUser(\"me\");",
        "}",
        "function boxed() {",
        "  let box;",
        "  const next = getUser(\"me\");",
        "  box = next;",
        "  return next;",
        "}",
        "function preload() {",
        "  return load;",
        "}",
        "export function View(props: { data: Promise<string>; id: string }) {",
        "  return [",
        "    use(props.data || getUser(props.id)),",
        "    use(new Holder().p),",
        "    <Child {...{ p: getUser(props.id) }} />,",
        "    use(shadow()),",
        "    use(either()),",
        "    use(boxed()),",
        "    use(preload.call(undefined)),",
        "  ];",
        "}",
        "",
      ].join("\n"),
    },
    created("apps/web/src/view.tsx", "lines 27, 28, 30, 31, 32, 33"),
    untraced("apps/web/src/view.tsx", "line 29"),
  );
});

test("use-promise lists each verdict's lines apart", (t) => {
  fails(
    t,
    {},
    { "apps/web/src/view.tsx": '"use client";\nimport { use } from "react";\nexport const View = (props) => [use(fetch("/a")),\n  use((0, props.data))];\n' },
    created("apps/web/src/view.tsx", "line 3"),
    untraced("apps/web/src/view.tsx", "line 4"),
  );
});
