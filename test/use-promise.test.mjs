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
  "apps/web/src/theme.ts": 'import { createContext } from "react";\nexport const ThemeContext = createContext("light");\n',
};
const CACHED = { "cached-modules": ["apps/web/src/lib/cached.ts"] };
const CREATED = "A new promise on each render suspends forever. Take the promise as a prop from a Server Component, or call a function from a module that cached-modules in .standard/config.json lists.";
const UNTRACED = "The check fails closed here, since a promise made during render suspends forever. Take the promise as a prop, call a function from a module that cached-modules lists, or read a context that createContext makes in a file the check can resolve.";
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
  return { cwd, ...standard(cwd, ["check", "use-promise", ...flags]) };
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
      "apps/web/src/shared.tsx": '"use client";\nimport { use } from "react";\nimport { shared } from "@/api/users";\nexport const View = () => use(shared);\n',
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
      "  return [use(props.data), use(data), use(user), use(viaBarrel(props.id)), use(ThemeContext), use(Local), use(props.id ? data : props.data)];",
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
