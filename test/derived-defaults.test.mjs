import assert from "node:assert/strict";
import test from "node:test";
import { loadRepo } from "../src/repo.mjs";
import boundaries from "../src/checks/boundaries.mjs";
import screenshot from "../src/checks/pr-screenshot.mjs";
import banned from "../src/checks/banned.mjs";
import { git, tempRepo, write, pullRequestRepo } from "./helpers.mjs";

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

test("derived hooks run lint-staged, typecheck, test and the fixed extra script", (t) => {
  const repo = fixture(t, { "scripts/pre-push.sh": "true\n" });
  assert.deepEqual(repo.config.hooks, { "pre-commit": ["pnpm exec lint-staged"], "pre-push": ["pnpm typecheck", "pnpm test", "sh scripts/pre-push.sh"] });
});
