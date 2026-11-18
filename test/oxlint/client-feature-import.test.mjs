import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./server-first.helpers.mjs";

const S = "apps/web/src";

test("a browser file in one feature imports nothing from another feature", (t) => {
  const diagnostics = lint(t, "client-feature-import", {
    [`${S}/features/search/index.ts`]: 'export { SEARCH_PARAM, TAB_PARAM } from "./params";\nexport { SearchPanel } from "./panel";\n',
    [`${S}/features/search/params.ts`]: 'export const SEARCH_PARAM = "q";\nexport const TAB_PARAM = "tab";\nexport type Query = string;\n',
    [`${S}/features/search/panel.tsx`]: '"use client";\nexport const SearchPanel = () => null;\n',
    [`${S}/features/nav/nav-bar.tsx`]: '"use client";\nimport { SEARCH_PARAM, TAB_PARAM as tab } from "@/features/search";\nexport const NavBar = () => [SEARCH_PARAM, tab];\n',
    [`${S}/features/nav/deep.tsx`]: '"use client";\nimport { SearchPanel } from "../search/panel";\nexport const Deep = () => SearchPanel;\n',
    [`${S}/features/nav/reached.ts`]: 'import * as params from "@/features/search/params";\nexport const reached = params;\n',
    [`${S}/features/nav/menu.browser.tsx`]: 'import { reached } from "./reached";\nexport { SEARCH_PARAM } from "@/features/search";\nexport * from "@/features/search/params";\nexport const Menu = () => import("@/features/search");\nexport const value = reached;\n',
    [`${S}/features/nav/typed.tsx`]: '"use client";\nimport type { Query } from "@/features/search/params";\nimport { type Query as Q } from "@/features/search";\nexport type Both = [Query, Q];\n',
    [`${S}/features/nav/own.tsx`]: '"use client";\nimport { NavBar } from "./nav-bar";\nimport { Deep } from "@/features/nav/deep";\nexport const Own = () => [NavBar, Deep];\n',
    [`${S}/features/nav/server.tsx`]: 'import { SearchPanel } from "@/features/search";\nexport const Server = () => SearchPanel;\n',
    [`${S}/features/discover/brand/posts.tsx`]: '"use client";\nimport { thread } from "../messages/thread";\nexport const Posts = () => thread;\n',
    [`${S}/features/discover/messages/thread.ts`]: "export const thread = 1;\n",
    [`${S}/app/search/page.tsx`]: '"use client";\nimport { NavBar } from "@/features/nav/nav-bar";\nimport { SearchPanel } from "@/features/search";\nexport default function Page() { return [NavBar, SearchPanel]; }\n',
    [`${S}/components/shell/header.tsx`]: '"use client";\nimport { SEARCH_PARAM } from "@/features/search";\nexport const Header = () => SEARCH_PARAM;\n',
  });
  assert.deepEqual(diagnostics.map(({ filename }) => filename), [
    `${S}/features/nav/deep.tsx`,
    `${S}/features/nav/menu.browser.tsx`,
    `${S}/features/nav/menu.browser.tsx`,
    `${S}/features/nav/menu.browser.tsx`,
    `${S}/features/nav/nav-bar.tsx`,
    `${S}/features/nav/reached.ts`,
  ]);
  const [deep, reexport, all, lazy, nav, reached] = diagnostics.map(({ message }) => message);
  assert.equal(nav, "Move SEARCH_PARAM, TAB_PARAM out of src/features/search into src/lib or src/components/<group> and import them from there. This file ships to the browser from src/features/nav, so importing another feature bundles that feature into every page that loads this one; features meet only in src/app routes.");
  assert.match(deep, /^Move SearchPanel out of src\/features\/search /);
  assert.match(reexport, /^Move SEARCH_PARAM out of src\/features\/search /);
  assert.match(all, /^Move what this file uses from @\/features\/search\/params out of src\/features\/search /);
  assert.match(lazy, /^Move what this file uses from @\/features\/search out of src\/features\/search /);
  assert.match(reached, /^Move what this file uses from @\/features\/search\/params out of src\/features\/search /);
});
