import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const NEXT_APP = { "apps/web/package.json": { dependencies: { next: "16.0.0", react: "19.0.0" } } };
const FIX = "Move the read into a small async component that awaits it inside <Suspense>, or start the request without await and pass the promise down.";
const NO_BASELINE = "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.";

function check(t, files, ...flags) {
  const cwd = tempRepo(t);
  write(cwd, { ...NEXT_APP, ...files });
  git(cwd, "add", "-A");
  return { cwd, ...standard(cwd, ["check", "route-await", ...flags]) };
}

function fails(t, files, ...fixes) {
  const { stdout, stderr, status } = check(t, files);
  assert.equal(stderr, "");
  assert.equal(stdout, [`route-await: ${fixes.length} new findings.`, ...fixes.map((fix) => `  ${fix}`), NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
}

function passes(t, files) {
  const { stdout, stderr, status } = check(t, files);
  assert.deepEqual({ stdout, stderr, status }, { stdout: "route-await: OK\n", stderr: "", status: 0 });
}

const said = (path, lines) => `${path}: its default export awaits data on ${lines}, so the route renders nothing until it arrives. ${FIX}`;

test("route-await fails an await in a page or layout's default export, in any declaration form and any block", (t) => {
  fails(
    t,
    {
      "apps/web/src/app/page.tsx": 'export default async function Page() {\n  const user = await getUser();\n  if (user) {\n    await track(user);\n  }\n  return user;\n}\n',
      "apps/web/src/app/(shop)/[id]/layout.tsx": 'import { cookies } from "next/headers";\nconst Layout = async ({ children }) => {\n  const jar = await cookies();\n  return [jar, children];\n};\nexport default Layout;\n',
      "apps/web/app/orders/page.jsx": "export default async () => {\n  const [a, b] = await Promise.all([one(), two()]);\n  return a + b;\n};\n",
    },
    said("apps/web/app/orders/page.jsx", "line 2"),
    said("apps/web/src/app/(shop)/[id]/layout.tsx", "line 3"),
    said("apps/web/src/app/page.tsx", "lines 2, 4"),
  );
});

test("route-await passes an await of params or searchParams in any binding form", (t) => {
  passes(t, {
    "apps/web/src/app/a/page.tsx": "export default async function Page({ params }) {\n  const { id } = await params;\n  return id;\n}\n",
    "apps/web/src/app/b/page.tsx": "export default async function Page(props) {\n  const { id } = await props.params;\n  const query = await props['searchParams'];\n  return [id, query];\n}\n",
    "apps/web/src/app/c/page.tsx": "export default async function Page({ params: route, searchParams: query }) {\n  return [(await route).id, await query];\n}\n",
    "apps/web/src/app/d/page.tsx": "export default async function Page(props: { params: Promise<{ id: string }> }) {\n  const { params } = props;\n  const route = params;\n  const { id } = await (route as Promise<{ id: string }>);\n  return id;\n}\n",
  });
});

test("route-await passes awaits outside the default export's own body, in tests, and outside a route file", (t) => {
  passes(t, {
    "apps/web/src/app/page.tsx": [
      'import { Suspense } from "react";',
      "async function Orders() {",
      "  const orders = await getOrders();",
      "  return orders;",
      "}",
      "export async function generateMetadata() {",
      "  return { title: (await getUser()).name };",
      "}",
      "export default function Page() {",
      "  const save = async () => {",
      "    await post();",
      "  };",
      "  return [<Suspense><Orders /></Suspense>, save];",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/app/page.test.tsx": "export default async function Page() {\n  await getUser();\n}\n",
    "apps/web/src/__fixtures__/app/page.tsx": "export default async function Page() {\n  await getUser();\n}\n",
    "apps/web/src/features/page.tsx": "export default async function Page() {\n  await getUser();\n}\n",
    "apps/web/src/app/route.ts": "export async function GET() {\n  return Response.json(await getUser());\n}\n",
  });
});

test("route-await keeps a baseline that records today's awaits and fails one more in the same file", (t) => {
  const { cwd } = check(t, { "apps/web/src/app/page.tsx": "export default async function Page() {\n  return await getUser();\n}\n" }, "--init");
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/route-await.json"), "utf8")), { "route-await": ["apps/web/src/app/page.tsx await"] });
  write(cwd, { "apps/web/src/app/page.tsx": "export default async function Page() {\n  await track();\n  return await getUser();\n}\n" });
  const { stdout, status } = standard(cwd, ["check", "route-await"]);
  assert.match(stdout, /^route-await: 1 new findings\.\n {2}apps\/web\/src\/app\/page\.tsx: its default export awaits data on lines 2, 3,/);
  assert.equal(status, 1);
});

test("route-await does not apply when no tracked package.json declares next", (t) => {
  const cwd = tempRepo(t);
  write(cwd, { "package.json": { dependencies: { react: "19.0.0" } }, "app/page.tsx": "export default async function Page() {\n  await getUser();\n}\n" });
  git(cwd, "add", "-A");
  assert.equal(standard(cwd, ["check", "route-await"]).stdout, "route-await: skipped, no tracked package.json declares next\n");
});
