import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const APP = {
  "apps/web/package.json": { dependencies: { next: "16.0.0", react: "19.0.0" } },
  "apps/web/tsconfig.json": { compilerOptions: { module: "esnext", moduleResolution: "bundler", paths: { "@/*": ["./src/*"] } } },
  "apps/web/src/components/error-boundary.tsx": '"use client";\nexport function ErrorBoundary({ children }) {\n  return children;\n}\n',
};
/** TypeScript 7's API server prints this when the check closes it, after the run has finished. */
const TSGO_SHUTDOWN = /^context canceled\n/m;
const NO_BASELINE = "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.";
const BOUNDARY = { "error-boundaries": ["apps/web/src/components/error-boundary.tsx#ErrorBoundary", "react-error-boundary#ErrorBoundary"] };

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
  const run = standard(cwd, ["check", "suspense-errors", ...flags]);
  return { cwd, ...run, stderr: run.stderr.replace(TSGO_SHUTDOWN, "") };
}

function fails(t, config, files, ...fixes) {
  const { stdout, stderr, status } = check(t, config, files);
  assert.equal(stderr, "");
  assert.equal(stdout, [`suspense-errors: ${fixes.length} new findings.`, ...fixes.map((fix) => `  ${fix}`), NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
}

function passes(t, config, files) {
  const { stdout, stderr, status } = check(t, config, files);
  assert.deepEqual({ stdout, stderr, status }, { stdout: "suspense-errors: OK\n", stderr: "", status: 0 });
}

const suspense = 'import { Suspense } from "react";\nexport default function Page() {\n  return <Suspense fallback={null}><Orders /></Suspense>;\n}\n';
const LISTED = "wrap the <Suspense> in a component that error-boundaries in .standard/config.json lists or that catchError makes in the same file.";
const bare = (path, lines, segment) => `${path} renders <Suspense> on ${lines}, and no error boundary wraps it. Add an error.tsx to ${segment} or a parent segment, or ${LISTED}`;
const layout = (path, lines, segment, kind = "layout") => `${path} renders <Suspense> on ${lines}, and no error boundary wraps it. A segment's error.tsx does not catch its own ${kind}, so add an error.tsx to a parent of ${segment}, or ${LISTED}`;
const rootLayout = (path, lines, root) => `${path} renders <Suspense> on ${lines}, and no error boundary wraps it. No error.tsx catches the root layout, so add a global-error.tsx to ${root}, or ${LISTED}`;
const loading = (path, segment) => `${path} is the Suspense boundary of ${segment}, and no error boundary covers it. Add an error.tsx to ${segment} or a parent segment, or a global-error.tsx to the app folder.`;
const ERROR = '"use client";\nexport default function Error() {\n  return null;\n}\n';

test("suspense-errors fails a Suspense in a route segment that no error.tsx covers, through any binding of Suspense", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/app/(shop)/orders/page.tsx": suspense,
      "apps/web/src/app/(shop)/orders/_parts/list.tsx": 'import { Suspense as Wait } from "react";\nexport const List = () => <Wait />;\n',
      "apps/web/src/app/(shop)/orders/_parts/grid.tsx": 'import * as React from "react";\nexport const Grid = () => <React.Suspense />;\n',
      "apps/web/src/app/(shop)/orders/_parts/row.tsx": 'import React from "react";\nexport const Row = () => <React.Suspense />;\n',
    },
    bare("apps/web/src/app/(shop)/orders/_parts/grid.tsx", "line 2", "apps/web/src/app/(shop)/orders/_parts"),
    bare("apps/web/src/app/(shop)/orders/_parts/list.tsx", "line 2", "apps/web/src/app/(shop)/orders/_parts"),
    bare("apps/web/src/app/(shop)/orders/_parts/row.tsx", "line 2", "apps/web/src/app/(shop)/orders/_parts"),
    bare("apps/web/src/app/(shop)/orders/page.tsx", "line 3", "apps/web/src/app/(shop)/orders"),
  );
});

test("suspense-errors fails a Suspense in a layout or template that only its own segment's error.tsx covers", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/app/layout.tsx": 'import { Suspense } from "react";\nexport default function Layout({ children }) {\n  return <Suspense>{children}</Suspense>;\n}\n',
      "apps/web/src/app/error.tsx": ERROR,
      "apps/web/src/app/(shop)/template.tsx": 'import { Suspense } from "react";\nexport default function Template({ children }) {\n  return <Suspense>{children}</Suspense>;\n}\n',
      "apps/web/src/app/(shop)/orders/layout.tsx": 'import { Suspense } from "react";\nexport default function Layout({ children }) {\n  return <Suspense>{children}</Suspense>;\n}\n',
      "apps/web/src/app/(shop)/orders/error.tsx": ERROR,
    },
    rootLayout("apps/web/src/app/layout.tsx", "line 3", "apps/web/src/app"),
  );
});

test("suspense-errors fails a Suspense in a nested layout or template whose own segment alone has an error file", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/app/(shop)/template.tsx": 'import { Suspense } from "react";\nexport default function Template({ children }) {\n  return <Suspense>{children}</Suspense>;\n}\n',
      "apps/web/src/app/(shop)/error.tsx": ERROR,
      "apps/web/src/app/orders/layout.jsx": 'import { Suspense } from "react";\nexport default function Layout({ children }) {\n  return <Suspense>{children}</Suspense>;\n}\n',
      "apps/web/src/app/orders/error.tsx": ERROR,
    },
    layout("apps/web/src/app/(shop)/template.tsx", "line 3", "apps/web/src/app/(shop)", "template"),
    layout("apps/web/src/app/orders/layout.jsx", "line 3", "apps/web/src/app/orders"),
  );
});

test("suspense-errors fails a loading file that no error file covers, as the Suspense of its segment", (t) => {
  fails(
    t,
    {},
    {
      "apps/web/src/app/orders/loading.tsx": "export default function Loading() {\n  return null;\n}\n",
      "apps/web/src/app/orders/page.tsx": "export default async function Page() {\n  return null;\n}\n",
      "apps/web/src/app/shop/loading.js": "export default function Loading() {\n  return null;\n}\n",
      "apps/web/src/app/shop/error.js": ERROR,
      "apps/web/src/app/(team)/members/loading.tsx": "export default function Loading() {\n  return null;\n}\n",
      "apps/web/src/app/(team)/error.tsx": ERROR,
    },
    loading("apps/web/src/app/orders/loading.tsx", "apps/web/src/app/orders"),
  );
});

test("suspense-errors keeps one finding per Suspense and lists each on a shared line by column", (t) => {
  const { cwd, stdout, status } = check(t, {}, { "apps/web/app/a/page.tsx": 'import { Suspense } from "react";\nexport default function Page() {\n  return [<Suspense />,\n    <Suspense />, <Suspense />];\n}\n' }, "--init");
  assert.equal(status, 0, stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/suspense-errors.json"), "utf8")), { "suspense-errors": Array(3).fill("apps/web/app/a/page.tsx Suspense") });
  rmSync(join(cwd, ".standard/baselines"), { recursive: true });
  git(cwd, "add", "-A");
  const run = standard(cwd, ["check", "suspense-errors"]);
  assert.equal(run.stdout, ["suspense-errors: 1 new findings.", `  ${bare("apps/web/app/a/page.tsx", "lines 3, 4:5, 4:19", "apps/web/app/a")}`, NO_BASELINE, ""].join("\n"));
});

test("suspense-errors fails a Suspense in a route segment that no error.tsx covers and no boundary wraps", (t) => {
  fails(
    t,
    BOUNDARY,
    {
      "apps/web/app/orders/page.tsx": 'import { Suspense } from "react";\nimport { ErrorBoundary } from "@/components/error-boundary";\nexport default function Page() {\n  return [<Suspense />, <ErrorBoundary><Suspense /></ErrorBoundary>];\n}\n',
      "apps/web/app/stock/page.tsx": 'import { Suspense } from "react";\nimport { catchError } from "./catch";\nconst Catch = catchError(() => null);\nexport default function Page() {\n  return <Catch><Suspense /></Catch>;\n}\n',
    },
    bare("apps/web/app/orders/page.tsx", "line 4", "apps/web/app/orders"),
    bare("apps/web/app/stock/page.tsx", "line 5", "apps/web/app/stock"),
  );
});

test("suspense-errors passes a Suspense under an error file in a parent segment", (t) => {
  passes(t, {}, {
    "apps/web/src/app/error.js": ERROR,
    "apps/web/src/app/loading.tsx": "export default function Loading() {\n  return null;\n}\n",
    "apps/web/src/app/(shop)/orders/page.tsx": suspense,
    "apps/web/src/app/(shop)/orders/layout.tsx": 'import { Suspense } from "react";\nexport default function Layout({ children }) {\n  return <Suspense>{children}</Suspense>;\n}\n',
  });
});

test("suspense-errors passes a Suspense anywhere under the app folder once global-error.tsx exists", (t) => {
  passes(t, {}, {
    "apps/web/src/app/global-error.tsx": '"use client";\nexport default function GlobalError() {\n  return null;\n}\n',
    "apps/web/src/app/layout.tsx": 'import { Suspense } from "react";\nexport default function Layout({ children }) {\n  return <Suspense>{children}</Suspense>;\n}\n',
    "apps/web/src/app/(shop)/orders/page.tsx": suspense,
  });
});

test("suspense-errors passes a Suspense inside a listed boundary, in a test, or outside the app folder", (t) => {
  passes(t, BOUNDARY, {
    "apps/web/app/a/page.tsx": 'import { Suspense } from "react";\nimport { ErrorBoundary as Catch } from "../../src/components/error-boundary";\nexport default function Page() {\n  return <Catch><div><Suspense /></div></Catch>;\n}\n',
    "apps/web/app/b/page.tsx": 'import { Suspense } from "react";\nimport { ErrorBoundary } from "react-error-boundary";\nexport default function Page() {\n  return <ErrorBoundary fallback={null}><Suspense /></ErrorBoundary>;\n}\n',
    "apps/web/app/c/page.tsx": 'import { Suspense } from "react";\nimport { catchError as boundary } from "next/error";\nconst Catch = boundary(() => null);\nexport default function Page() {\n  return <Catch><Suspense /></Catch>;\n}\n',
    "apps/web/src/components/feed.tsx": suspense,
    "apps/web/app/orders/page.test.tsx": suspense,
    "apps/web/app/__tests__/page.tsx": suspense,
  });
});

test("suspense-errors refuses an error-boundaries entry that does not name an export", (t) => {
  const { stdout, stderr, status } = check(t, { "error-boundaries": ["react-error-boundary"] }, {});
  assert.deepEqual({ stdout, stderr: stderr.trim(), status }, { stdout: "", stderr: 'standard: .standard/config.json error-boundaries has "react-error-boundary". Write a package or repository file, then # and the export, such as "react-error-boundary#ErrorBoundary".', status: 1 });
});

test("suspense-errors keeps a baseline that records today's sites and fails a new one", (t) => {
  const { cwd } = check(t, {}, { "apps/web/app/a/page.tsx": suspense }, "--init");
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/suspense-errors.json"), "utf8")), { "suspense-errors": ["apps/web/app/a/page.tsx Suspense"] });
  write(cwd, { "apps/web/app/b/page.tsx": suspense });
  git(cwd, "add", "-A");
  const { stdout, status } = standard(cwd, ["check", "suspense-errors"]);
  assert.match(stdout, /^suspense-errors: 1 new findings\.\n {2}apps\/web\/app\/b\/page\.tsx renders <Suspense>/);
  assert.equal(status, 1);
});
