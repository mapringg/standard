import assert from "node:assert/strict";
import test from "node:test";
import { loadRepo } from "../src/repo.mjs";
import boundaries from "../src/checks/boundaries.mjs";
import screenshot from "../src/checks/pr-screenshot.mjs";
import banned from "../src/checks/banned.mjs";
import noComments from "../src/checks/no-comments.mjs";
import { git, tempRepo, write, pullRequestRepo, standard } from "./helpers.mjs";

function fixture(t, files) {
  const root = tempRepo(t, {});
  write(root, { "package.json": { type: "module", dependencies: { next: "16", react: "19" }, scripts: { typecheck: "tsc", test: "node --test" } }, ...files });
  git(root, "add", ".");
  return loadRepo(root);
}

test("derived Next layering forbids all three directions", async (t) => {
  const repo = fixture(t, {
    "src/features/cart/index.ts": 'export { value } from "../../app/value";',
    "src/app/value.ts": 'export const value = 1;',
    "src/components/button.ts": 'import { value } from "../features/cart";',
    "src/app/page.ts": 'import { secret } from "../features/cart/data.server";',
    "src/features/cart/data.server.ts": 'export const secret = 1;',
  });
  const findings = await boundaries.run(repo, []);
  for (const file of ["src/features/cart/index.ts", "src/components/button.ts", "src/app/page.ts"]) assert.ok(findings.some(({ key, fix }) => key.startsWith(file) && /feature|route/.test(fix)), JSON.stringify(findings));
});

test("derived modules permit fixed lib owners and skip every non-product importer", async (t) => {
  const repo = fixture(t, {
    "src/app/page.ts": 'import { swr } from "../lib/swr"; import { json } from "../lib/json.server";',
    "src/lib/swr.ts": 'export const swr = 1;',
    "src/lib/json.server.ts": 'export const json = 1;',
    "src/features/cart/private.ts": 'export const privateValue = 1;',
    ...Object.fromEntries(["src/a.test.ts", "src/a.spec.ts", "src/a.stories.ts", "test/a.ts", "scripts/a.ts", "evals/a.ts", "fixtures/a.ts", "root.config.ts"].map((file) => [file, 'import { privateValue } from "missing"; import { useEffect } from "react"; useEffect(() => {});'])),
  });
  assert.deepEqual(await boundaries.run(repo, []), []);
  assert.deepEqual(await banned.run(repo, []), []);
});

test("derived screenshots cover React apps and exclude non-product changes", async (t) => {
  for (const [file, needed] of [["src/button.tsx", true], ["src/button.spec.tsx", false], ["scripts/preview.tsx", false]]) {
    const pr = pullRequestRepo(t, { base: { ".standard/config.json": {}, "package.json": { dependencies: { react: "19", vite: "8" } } }, head: { [file]: "export const value = 1;" } });
    const repo = loadRepo(pr.cwd);
    assert.equal(screenshot.applies(repo).on, true);
    const findings = await screenshot.run({ baseSha: pr.base, headSha: pr.head, body: "", number: 1 }, repo);
    assert.equal(findings.length, needed ? 1 : 0, file);
  }
});

test("derived screenshots cover each React app's public folder, images and fonts", async (t) => {
  const cases = [["apps/web/public/robots.txt", true], ["apps/web/src/app/icon.svg", true], ["apps/web/src/app/opengraph-image.png", true], ["apps/web/src/assets/hero.webp", true], ["apps/web/src/fonts/inter.woff2", true], ["apps/web/README.md", false], ["apps/api/public/robots.txt", false], ["apps/api/src/logo.svg", false]];
  for (const [file, needed] of cases) {
    const pr = pullRequestRepo(t, { base: { ".standard/config.json": {}, "package.json": {}, "apps/web/package.json": { dependencies: { react: "19", next: "16" } }, "apps/api/package.json": { dependencies: { hono: "4" } } }, head: { [file]: "x" } });
    const findings = await screenshot.run({ baseSha: pr.base, headSha: pr.head, body: "", number: 1 }, loadRepo(pr.cwd));
    assert.equal(findings.length, needed ? 1 : 0, file);
  }
});

test("derived hooks run lint-staged, typecheck, test and the fixed extra script", (t) => {
  const repo = fixture(t, { "scripts/pre-push.sh": "true\n" });
  assert.deepEqual(repo.config.hooks, { "pre-commit": ["pnpm exec lint-staged"], "pre-push": ["pnpm typecheck", "pnpm test", "sh scripts/pre-push.sh"] });
});

test("flat configs retain mocking and comment bans on non-product sources", async (t) => {
  const files = ["src/a.test.ts", "scripts/a.ts", "fixtures/a.ts"];
  const repo = fixture(t, Object.fromEntries(files.map((file) => [file, 'import { vi } from "vitest"; vi.mock("./b");\n// Explain a routine operation.\n'])));
  const mocks = await banned.run(repo, []);
  const comments = await noComments.run(repo, []);
  for (const file of files) {
    assert.ok(mocks.some(({ key }) => key.startsWith(`${file} `) && key.includes("vi.mock")), JSON.stringify(mocks));
    assert.ok(comments.some(({ key }) => key.startsWith(`${file} `)), JSON.stringify(comments));
  }
  const result = standard(repo.root, ["check", "banned"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /src\/a.test.ts vitest#vi.mock/);
});

test("each src/components folder is its own module, ui stays open, and index.server is an entry", async (t) => {
  const repo = fixture(t, {
    "src/components/chart/line.ts": 'import { cell } from "../table/cell"; import { Table } from "../table"; import { button } from "../ui/button"; import { axis } from "./axis"; export const line = [cell, Table, button, axis];',
    "src/components/chart/axis.ts": "export const axis = 1;",
    "src/components/table/cell.ts": "export const cell = 1;",
    "src/components/table/index.ts": 'export { cell as Table } from "./cell";',
    "src/components/ui/button.ts": "export const button = 1;",
    "src/features/report/index.server.ts": 'export { load } from "./load.server";',
    "src/features/report/load.server.ts": "export const load = 1;",
    "src/app/page.ts": 'import { line } from "../components/chart/line"; import { load } from "../features/report/index.server"; export const page = [line, load];',
  });
  const keys = (await boundaries.run(repo, [])).map(({ key }) => key).sort();
  assert.deepEqual(keys, ["src/app/page.ts imports ../components/chart/line", "src/components/chart/line.ts imports ../table/cell"]);
});

test("a module finding lists only the entries that apply to its importer", async (t) => {
  const repo = fixture(t, {
    "src/components/table/cell.ts": "export const cell = 1;",
    "src/features/report/view.ts": "export const view = 1;",
    "src/app/page.ts": 'import { cell } from "../components/table/cell"; import { view } from "../features/report/view"; export const page = [cell, view];',
    "src/app/chart.tsx": '"use client";\nimport { cell } from "../components/table/cell"; import { view } from "../features/report/view"; export const chart = [cell, view];',
  });
  const fixes = Object.fromEntries((await boundaries.run(repo, [])).map(({ key, fix }) => [key, fix.replace(/^.*Import it through /, "").replace(/, and export.*$/, "")]));
  assert.deepEqual(fixes, {
    "src/app/chart.tsx imports ../components/table/cell": "src/components/table/index",
    "src/app/chart.tsx imports ../features/report/view": "src/features/report/index or src/features/report/routes",
    "src/app/page.ts imports ../components/table/cell": "src/components/table/index or src/components/table/index.server",
    "src/app/page.ts imports ../features/report/view": "src/features/report/index or src/features/report/index.server or src/features/report/routes",
  });
});
