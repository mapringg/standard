import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const APPS = {
  "apps/web/package.json": { dependencies: { next: "16.0.0", react: "19.0.0" } },
  "apps/web/tsconfig.json": { compilerOptions: { module: "esnext", moduleResolution: "bundler", paths: { "@/*": ["./src/*"] } } },
  "apps/web/src/lib/swr.ts": '"use client";\nimport useSWRBase from "swr";\nexport function useSWR() {\n  return useSWRBase();\n}\nexport function useSWRInfinite() {}\nexport const useServerSeeded = useSWR;\n',
  "apps/web/src/lib/index.ts": 'export * from "./swr";\n',
  "apps/web/src/hooks/local.ts": "export function useSWR() {}\n",
  "apps/web/src/api/users.ts": 'export const getUser = () => fetch("/users/1");\nexport type User = { id: string };\n',
  "apps/web/src/data/index.ts": 'export * from "../api/users";\n',
  "apps/web/src/data/named.ts": 'export { getUser as loadUser } from "@/api/users";\n',
  "apps/web/src/data/format.ts": "export const format = String;\n",
};
const API = { "api-modules": ["apps/web/src/api/**"] };
const LISTED_FIX = "Read the data in a Server Component and pass it down as props, and send a write through a Server Action that refreshes the cache with revalidatePath or revalidateTag. If the browser must load the data, name the file <name>.data-<pages|live|client-state|unreachable>.tsx.";
const FETCH_FIX = "Read the data in a Server Component and pass it down as props, and send a write through a Server Action. If the browser must load the data, name the file <name>.data-<pages|live|client-state|unreachable>.tsx.";
/** TypeScript 7's API server prints this when the check closes it, after the run has finished. */
const TSGO_SHUTDOWN = /^context canceled\n/m;
const NO_BASELINE = "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.";

function repoWith(t, config, files) {
  const cwd = tempRepo(t, config);
  write(cwd, { ...APPS, ...files });
  mkdirSync(join(cwd, "node_modules"), { recursive: true });
  symlinkSync(join(import.meta.dirname, "../node_modules/typescript"), join(cwd, "node_modules/typescript"));
  git(cwd, "add", "-A");
  return cwd;
}

function check(t, config, files, ...flags) {
  const cwd = repoWith(t, config, files);
  const run = standard(cwd, ["check", "client-data", ...flags]);
  return { cwd, ...run, stderr: run.stderr.replace(TSGO_SHUTDOWN, "") };
}

function fails(t, config, files, ...fixes) {
  const { stdout, stderr, status } = check(t, config, files);
  assert.equal(stderr, "");
  assert.equal(stdout, [`client-data: ${fixes.length} new findings.`, ...fixes.map((fix) => `  ${fix}`), NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
}

function passes(t, config, files) {
  const { stdout, stderr, status } = check(t, config, files);
  assert.deepEqual({ stdout, stderr, status }, { stdout: "client-data: OK\n", stderr: "", status: 0 });
}

const useData = (from = "@/lib/swr") => `"use client";\nimport { useSWR } from "${from}";\nexport const View = () => useSWR(["user"], load, { fallbackData: null });\n`;

test("client-data fails the template's useSWR, or its former name, through any import or a re-export, and swr's own useSWR, in a file client-data does not list", (t) => {
  fails(
    t,
    API,
    {
      "apps/web/src/feed.tsx": useData(),
      "apps/web/src/bound.tsx": '"use client";\nimport * as Data from "./lib/swr";\nconst read = Data.useSWR;\nexport const View = () => read(["user"], load);\n',
      "apps/web/src/seeded.tsx": '"use client";\nimport { useServerSeeded } from "@/lib/swr";\nexport const View = () => useServerSeeded(["user"], load);\n',
      "apps/web/src/barrel.tsx": useData("@/lib"),
      "apps/web/src/direct.tsx": '"use client";\nimport useSWR from "swr";\nexport const View = () => useSWR(["user"], load);\n',
      "apps/web/src/pages.tsx": '"use client";\nimport { useSWRInfinite } from "@/lib/swr";\nexport const View = () => useSWRInfinite(["feed"], load);\n',
      "apps/web/src/local.tsx": '"use client";\nimport { useSWR } from "@/hooks/local";\nexport const View = () => useSWR();\n',
      "apps/web/src/feed.test.tsx": useData(),
      "apps/web/src/feed.stories.tsx": useData(),
      "apps/web/src/__fixtures__/feed.tsx": useData(),
    },
    `apps/web/src/barrel.tsx uses useSWR on lines 2, 3, and its name carries no data role. ${LISTED_FIX}`,
    `apps/web/src/bound.tsx uses useSWR on lines 3, 4, and its name carries no data role. ${LISTED_FIX}`,
    `apps/web/src/direct.tsx uses useSWR on lines 2, 3, and its name carries no data role. ${LISTED_FIX}`,
    `apps/web/src/feed.tsx uses useSWR on lines 2, 3, and its name carries no data role. ${LISTED_FIX}`,
    `apps/web/src/seeded.tsx uses useServerSeeded on lines 2, 3, and its name carries no data role. ${LISTED_FIX}`,
  );
});

test("client-data passes useSWR in a file listed with each reason", (t) => {
  const reasons = ["pages", "live", "client-state", "unreachable"];
  passes(
    t,
    { ...API, "client-data": reasons.map((reason) => ({ file: `apps/web/src/${reason}.tsx`, reason })) },
    Object.fromEntries(reasons.map((reason) => [`apps/web/src/${reason}.tsx`, useData()])),
  );
});

test("client-data refuses a config entry whose reason is not one it knows, or an app entry for a reason other than unreachable", (t) => {
  const invalid = [
    [{ "client-data": [{ file: "apps/web/src/feed.tsx", reason: "faster" }] }, '.standard/config.json client-data[0].reason is "faster". Give one of pages, live, client-state, unreachable.'],
    [{ "client-data": [{ file: "apps/web/src/feed.tsx" }] }, ".standard/config.json client-data[0].reason is undefined. Give one of pages, live, client-state, unreachable."],
    [{ "client-data": [{ app: "apps/admin", reason: "live" }] }, '.standard/config.json client-data[0] lists the whole app apps/admin for "live". Only an app whose server cannot reach its data goes in whole, with reason "unreachable"; list each file for another reason.'],
    [{ "client-data": [{ file: "apps/web/src/*.tsx", reason: "live" }] }, '.standard/config.json client-data[0].file has "apps/web/src/*.tsx", a glob. List each file by its exact path.'],
    [{ "client-data": [{ file: "a.tsx", app: "apps/admin", reason: "unreachable" }] }, ".standard/config.json client-data[0] names a file or an app; give it exactly one."],
    [{ "api-modules": "apps/web/src/api/**" }, ".standard/config.json api-modules must be a list of non-empty strings."],
  ];
  for (const [config, message] of invalid) {
    const { stdout, stderr, status } = check(t, config, {});
    assert.deepEqual({ stdout, stderr: stderr.trim(), status }, { stdout: "", stderr: `standard: ${message}`, status: 1 }, message);
  }
});

const CLIENT_FETCH = [
  '"use client";',
  'import { getUser as user } from "@/api/users";',
  'import { loadUser } from "@/data/named";',
  'import { getUser } from "./data";',
  'import type { User } from "@/api/users";',
  "const { fetch: load } = globalThis;",
  "const send = window.fetch;",
  "export async function save(body: User) {",
  '  await fetch("/a");',
  '  await globalThis.fetch("/b");',
  '  await load("/c");',
  '  await send("/d", { body: String(body) });',
  "  return [user, loadUser, getUser];",
  "}",
  "",
].join("\n");

test("client-data fails fetch in any form and an API module import, direct, aliased or through a re-export, in a use client file", (t) => {
  fails(
    t,
    API,
    { "apps/web/src/save.tsx": CLIENT_FETCH, "apps/web/src/format.tsx": '"use client";\nimport { format } from "@/data/format";\nexport const View = () => format(1);\n' },
    `apps/web/src/save.tsx uses fetch on lines 6, 7, 9, 10, 11, 12, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/save.tsx imports ./data on line 4, which reaches the API module apps/web/src/api/users.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/save.tsx imports @/api/users on line 2, which reaches the API module apps/web/src/api/users.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/save.tsx imports @/data/named on line 3, which reaches the API module apps/web/src/api/users.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
  );
});

test("client-data passes fetch and API module imports in a server file, a test, a story and a fixture, a local named fetch and a type-only import", (t) => {
  const server = CLIENT_FETCH.replace('"use client";\n', "");
  passes(t, API, {
    "apps/web/src/save.tsx": server,
    "apps/web/src/save.test.tsx": CLIENT_FETCH,
    "apps/web/src/save.stories.tsx": CLIENT_FETCH,
    "apps/web/src/fixtures/save.tsx": CLIENT_FETCH,
    "apps/web/src/typed.tsx": '"use client";\nimport type { User } from "@/api/users";\nexport const name = (user: User) => user.id;\n',
    "apps/web/src/late.tsx": 'export const load = () => fetch("/a");\n"use client";\n',
    "apps/web/src/param.tsx": '"use client";\nexport const load = (fetch: (url: string) => Promise<unknown>) => fetch("/a");\n',
  });
});

test("client-data passes a listed file that fetches, and a whole app listed as unreachable", (t) => {
  passes(
    t,
    { ...API, "client-data": [{ file: "apps/web/src/save.tsx", reason: "live" }, { app: "apps/admin", reason: "unreachable" }] },
    {
      "apps/web/src/save.tsx": `${CLIENT_FETCH}import { useSWR } from "@/lib/swr";\nexport const View = () => useSWR(["user"], getUser);\n`,
      "apps/admin/package.json": { dependencies: { vite: "8.0.0", react: "19.0.0" } },
      "apps/admin/src/session.tsx": useData("./lib/swr"),
      "apps/admin/src/save.tsx": '"use client";\nexport const save = () => fetch("/a");\n',
    },
  );
  fails(
    t,
    { ...API, "client-data": [{ app: "apps/admin", reason: "unreachable" }] },
    { "apps/admin/src/index.ts": "export {};\n", "apps/administration/src/save.tsx": '"use client";\nexport const save = () => fetch("/a");\n' },
    `apps/administration/src/save.tsx uses fetch on line 2, and "use client" runs it in the browser. ${FETCH_FIX}`,
  );
});

test("client-data keeps a baseline that records today's sites and fails a new one", (t) => {
  const cwd = repoWith(t, API, { "apps/web/src/feed.tsx": useData() });
  assert.equal(standard(cwd, ["check", "client-data", "--init"]).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/client-data.json"), "utf8")), { "client-data/listed": ["apps/web/src/feed.tsx useSWR"] });
  assert.equal(standard(cwd, ["check", "client-data"]).stdout, "client-data: OK\n");
  write(cwd, { "apps/web/src/other.tsx": useData() });
  git(cwd, "add", "-A");
  const { stdout, status } = standard(cwd, ["check", "client-data"]);
  assert.match(stdout, /^client-data: 1 new findings\.\n {2}apps\/web\/src\/other\.tsx uses useSWR on lines 2, 3,/);
  assert.equal(status, 1);
  const grown = standard(cwd, ["check", "client-data", "--write"]);
  assert.match(grown.stdout, /--write only re-keys findings that moved, and 2 findings would grow \.standard\/baselines\/client-data\.json past its 1 entries\./);
  assert.equal(grown.status, 1);
});

test("client-data does not apply when no tracked package.json declares react", (t) => {
  const cwd = tempRepo(t);
  write(cwd, { "package.json": {}, "src/a.ts": "export const a = fetch;\n" });
  git(cwd, "add", "-A");
  assert.equal(standard(cwd, ["check", "client-data"]).stdout, "client-data: skipped, no tracked package.json declares react\n");
});

test("client-data fails a dynamic import of an API module in a use client file", (t) => {
  fails(
    t,
    API,
    {
      "apps/web/src/lazy.tsx": '"use client";\nexport const load = async () => (await import("@/api/users")).getUser();\n',
      "apps/web/src/then.tsx": '"use client";\nexport const load = () => import("../src/api/users").then((api) => api.getUser());\n',
    },
    `apps/web/src/lazy.tsx imports @/api/users on line 2, which reaches the API module apps/web/src/api/users.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/then.tsx imports ../src/api/users on line 2, which reaches the API module apps/web/src/api/users.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
  );
});

test("client-data follows a use client file's imports through plain modules to an API module or fetch, and stops at use server, use client and listed files", (t) => {
  const view = (from) => `"use client";\nimport { load } from "${from}";\nexport const View = () => load();\n`;
  fails(
    t,
    { ...API, "client-data": [{ file: "apps/web/src/lib/listed.ts", reason: "live" }] },
    {
      "apps/web/src/features/users.browser.ts": 'import { getUser } from "@/api/users";\nexport const load = () => getUser();\n',
      "apps/web/src/features/deep.ts": 'import { load as inner } from "./users.browser";\nexport const load = () => inner();\n',
      "apps/web/src/lib/load.ts": 'export const load = () => fetch("/a");\n',
      "apps/web/src/lib/actions.ts": '"use server";\nimport { getUser } from "@/api/users";\nexport async function load() {\n  await getUser();\n}\n',
      "apps/web/src/lib/listed.ts": 'import { getUser } from "@/api/users";\nexport const load = () => getUser();\n',
      "apps/web/src/lib/panel.tsx": '"use client";\nexport const load = () => fetch("/a");\n',
      "apps/web/src/wrapped.tsx": view("@/features/users.browser"),
      "apps/web/src/deep.tsx": view("./features/deep"),
      "apps/web/src/fetched.tsx": view("@/lib/load"),
      "apps/web/src/action.tsx": view("@/lib/actions"),
      "apps/web/src/listed.tsx": view("@/lib/listed"),
      "apps/web/src/nested.tsx": view("@/lib/panel"),
    },
    `apps/web/src/deep.tsx imports ./features/deep on line 2, which reaches the API module apps/web/src/api/users.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/fetched.tsx imports @/lib/load on line 2, which reaches fetch in apps/web/src/lib/load.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/lib/panel.tsx uses fetch on line 2, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/wrapped.tsx imports @/features/users.browser on line 2, which reaches the API module apps/web/src/api/users.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
  );
});

test("client-data passes a type-only use of useSWR, and fails it through a two-level barrel and fetch.call or fetch.bind", (t) => {
  fails(
    t,
    API,
    {
      "apps/web/src/a/index.ts": 'export * from "../b";\n',
      "apps/web/src/b/index.ts": 'export * from "../lib/swr";\n',
      "apps/web/src/chain.tsx": useData("@/a"),
      "apps/web/src/typed.tsx": '"use client";\nimport type { useSWR } from "@/lib/swr";\nexport type Hook = typeof useSWR;\n',
      "apps/web/src/types.ts": 'export type { useSWR } from "@/lib/swr";\n',
      "apps/web/src/members.tsx": '"use client";\nexport const load = () => fetch.call(globalThis, "/a");\nexport const bound = fetch.bind(globalThis);\n',
    },
    `apps/web/src/chain.tsx uses useSWR on lines 2, 3, and its name carries no data role. ${LISTED_FIX}`,
    `apps/web/src/members.tsx uses fetch on lines 2, 3, and "use client" runs it in the browser. ${FETCH_FIX}`,
  );
});

test("client-data reads an app entry with a trailing slash as the app", (t) => {
  passes(t, { "api-modules": ["apps/admin/src/api/**"], "client-data": [{ app: "apps/admin/", reason: "unreachable" }] }, {
    "apps/admin/package.json": { dependencies: { vite: "8.0.0", react: "19.0.0" } },
    "apps/admin/src/save.tsx": '"use client";\nexport const save = () => fetch("/a");\n',
  });
});

test("client-data fails swr/immutable anywhere, and XMLHttpRequest, ky and axios in a use client file or a module it imports", (t) => {
  fails(
    t,
    API,
    {
      "apps/web/src/immutable.tsx": '"use client";\nimport useSWRImmutable from "swr/immutable";\nexport const View = () => useSWRImmutable(["user"], load);\n',
      "apps/web/src/xhr.tsx": '"use client";\nexport const load = () => new XMLHttpRequest();\n',
      "apps/web/src/ky.tsx": '"use client";\nimport ky from "ky";\nexport const load = () => ky.get("/a");\n',
      "apps/web/src/axios.tsx": '"use client";\nimport { get } from "axios";\nexport const load = () => get("/a");\n',
      "apps/web/src/lib/http.ts": 'import axios from "axios";\nexport const load = () => axios.get("/a");\n',
      "apps/web/src/wrapped.tsx": '"use client";\nimport { load } from "@/lib/http";\nexport const View = () => load();\n',
      "apps/web/src/typed.tsx": '"use client";\nimport type { Options } from "ky";\nexport const options: Options = {};\n',
    },
    `apps/web/src/axios.tsx uses axios on lines 2, 3, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/immutable.tsx uses useSWR on lines 2, 3, and its name carries no data role. ${LISTED_FIX}`,
    `apps/web/src/ky.tsx uses ky on lines 2, 3, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/wrapped.tsx imports @/lib/http on line 2, which reaches axios in apps/web/src/lib/http.ts, and "use client" runs it in the browser. ${FETCH_FIX}`,
    `apps/web/src/xhr.tsx uses XMLHttpRequest on line 2, and "use client" runs it in the browser. ${FETCH_FIX}`,
  );
});

test("client-data fails a listed file or app that git does not track, and an empty api-modules in a repo with a Next app", (t) => {
  fails(
    t,
    { "client-data": [{ file: "apps/web/src/gone.tsx", reason: "live" }, { app: "apps/gone", reason: "unreachable" }] },
    {},
    'api-modules in .standard/config.json is empty, and apps/web is a Next app. List the globs of its API modules, so that a "use client" file that imports one fails.',
    "client-data in .standard/config.json lists apps/gone, which holds no tracked file. Remove the entry, or fix its path.",
    "client-data in .standard/config.json lists apps/web/src/gone.tsx, which git does not track. Remove the entry, or fix its path.",
  );
});
