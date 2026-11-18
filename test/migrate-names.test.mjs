import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const WEB = "apps/web/src";
const CONFIG = {
  pr: { "ticket-prefix": "ABC" },
  "effect-wrappers": [
    { file: `${WEB}/hooks/use-window-event.ts`, reason: "Subscribes a listener to a window event while active." },
    { file: `${WEB}/app-shell/nav-sync.tsx`, reason: "Rolls the session after a navigation; Next exposes the pathname only through a hook." },
    { file: `${WEB}/map/use-bind.browser.ts`, reason: "Binds props to the map instance, which renders no element." },
    { file: `${WEB}/home/panel.tsx`, reason: "Reads the collections after mount." },
  ],
  "client-data": [
    { file: `${WEB}/features/list.tsx`, reason: "pages" },
    { file: `${WEB}/app-shell/nav-sync.tsx`, reason: "unreachable" },
  ],
};

function fixture(t) {
  const cwd = tempRepo(t, CONFIG);
  write(cwd, {
    "apps/web/package.json": { dependencies: { next: "16.0.0", react: "19.0.0" } },
    "apps/web/tsconfig.json": { compilerOptions: { module: "esnext", moduleResolution: "bundler", paths: { "@/*": ["./src/*"] } } },
    [`${WEB}/hooks/use-window-event.ts`]: "export function useWindowEvent() {}\n",
    [`${WEB}/app-shell/nav-sync.tsx`]: "export function NavSync() { return null; }\n",
    [`${WEB}/map/use-bind.browser.ts`]: "export function useBind() {}\n",
    [`${WEB}/home/panel.tsx`]: "export function Panel() { return null; }\n",
    [`${WEB}/features/list.tsx`]: 'import { useWindowEvent } from "../hooks/use-window-event";\nexport { useWindowEvent };\n',
    [`${WEB}/app/layout.tsx`]: 'import { NavSync } from "@/app-shell/nav-sync";\nimport { useBind } from \'@/map/use-bind.browser\';\nexport * from "../features/list";\nexport const lazy = () => import("../home/panel");\nexport { NavSync, useBind };\n',
    ".standard/baselines/client-data.json": { findings: [`${WEB}/features/list.tsx imports ../hooks/use-window-event`] },
  });
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", "fixture", "--no-verify");
  return cwd;
}

const PLAN = [
  `rename ${WEB}/hooks/use-window-event.ts -> ${WEB}/hooks/use-window-event.effect-subscribe.ts`,
  `rename ${WEB}/app-shell/nav-sync.tsx -> ${WEB}/app-shell/nav-sync.data-unreachable.effect-route.tsx`,
  `rename ${WEB}/map/use-bind.browser.ts -> ${WEB}/map/use-bind.effect-sync.browser.ts`,
  `rename ${WEB}/features/list.tsx -> ${WEB}/features/list.data-pages.tsx`,
  `pick ${WEB}/home/panel.tsx: "Reads the collections after mount." Rerun with --effect ${WEB}/home/panel.tsx=<sync|route|subscribe>, or rewrite the effect.`,
];

test("migrate names plans renames without writing by default", (t) => {
  const cwd = fixture(t);
  const run = standard(cwd, ["migrate", "names"]);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split("\n"), [...PLAN, "Dry run: 4 renames, 4 imports in 2 files. Run with --write to apply."]);
  assert.equal(git(cwd, "status", "--porcelain"), "");
});

test("migrate names --write renames, rewrites imports and prunes the legacy lists, and a second run changes nothing", (t) => {
  const cwd = fixture(t);
  const run = standard(cwd, ["migrate", "names", "--write"]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim().split("\n").at(-1), "Renamed 4 files and rewrote 4 imports in 2 files. 1 effect wrapper needs a reason.");
  assert.ok(existsSync(join(cwd, `${WEB}/map/use-bind.effect-sync.browser.ts`)));
  assert.ok(!existsSync(join(cwd, `${WEB}/map/use-bind.browser.ts`)));
  assert.equal(readFileSync(join(cwd, `${WEB}/app/layout.tsx`), "utf8"), 'import { NavSync } from "@/app-shell/nav-sync.data-unreachable.effect-route";\nimport { useBind } from \'@/map/use-bind.effect-sync.browser\';\nexport * from "../features/list.data-pages";\nexport const lazy = () => import("../home/panel");\nexport { NavSync, useBind };\n');
  assert.equal(readFileSync(join(cwd, `${WEB}/features/list.data-pages.tsx`), "utf8"), 'import { useWindowEvent } from "../hooks/use-window-event.effect-subscribe";\nexport { useWindowEvent };\n');
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/config.json"), "utf8")), { pr: { "ticket-prefix": "ABC" }, "effect-wrappers": [CONFIG["effect-wrappers"][3]] });
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/client-data.json"), "utf8")), { findings: [`${WEB}/features/list.data-pages.tsx imports ../hooks/use-window-event.effect-subscribe`] });
  assert.match(git(cwd, "status", "--porcelain"), new RegExp(`R  ${WEB}/map/use-bind.browser.ts -> ${WEB}/map/use-bind.effect-sync.browser.ts`));
  const again = standard(cwd, ["migrate", "names", "--write"]);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(again.stdout.trim().split("\n"), [PLAN[4], "Renamed 0 files and rewrote 0 imports in 0 files. 1 effect wrapper needs a reason."]);
});

test("migrate names takes a human's pick for an ambiguous effect wrapper", (t) => {
  const cwd = fixture(t);
  const run = standard(cwd, ["migrate", "names", "--write", "--effect", `${WEB}/home/panel.tsx=sync`]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(join(cwd, `${WEB}/home/panel.effect-sync.tsx`)));
  assert.match(readFileSync(join(cwd, `${WEB}/app/layout.tsx`), "utf8"), /import\("\.\.\/home\/panel\.effect-sync"\)/);
  assert.equal(JSON.parse(readFileSync(join(cwd, ".standard/config.json"), "utf8"))["effect-wrappers"], undefined);
});

test("migrate names refuses an unknown subcommand, flag or effect reason", (t) => {
  const cwd = fixture(t);
  for (const [args, message] of [[["migrate"], /migrate takes names/], [["migrate", "names", "--force"], /Unexpected argument --force/], [["migrate", "names", "--effect", `${WEB}/home/panel.tsx=mount`], /--effect needs <file>=<sync\|route\|subscribe>/]]) {
    const run = standard(cwd, args);
    assert.equal(run.status, 1);
    assert.match(run.stderr, message);
  }
});
