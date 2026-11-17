import assert from "node:assert/strict";
import { test } from "node:test";

import { checkEvent, git, pullRequestEvent, pullRequestRepo, standard, tempRepo, write } from "./helpers.mjs";

const NO_BASELINE = "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.";
const FIX = "Put the decision in a name, a type or a test, and delete the pointer. The doc stays reachable from AGENTS.md.";
const DOCS = { "docs/time.md": "# Time\n\n## Why UTC\n" };

function pointers(t, files, ...flags) {
  const cwd = tempRepo(t, {});
  write(cwd, { ...DOCS, ...files });
  git(cwd, "add", "-A");
  return { cwd, ...standard(cwd, ["check", "no-doc-pointers", ...flags]) };
}

test("no-doc-pointers fails each See: pointer in source, whatever it names, and passes other comments and strings", (t) => {
  const { stdout, status } = pointers(t, {
    "src/a.ts": "// See: docs/time.md#why-utc\nexport const a = 1;\n/* See: docs/missing.md */\n",
    "src/b.tsx": 'export const b = "// See: docs/time.md";\n// See the docs\n',
    "node_modules/x/c.js": "// See: docs/time.md\n",
  });
  assert.equal(stdout, ["no-doc-pointers: 1 new findings.", `  src/a.ts has See: pointers on lines 1, 3. ${FIX}`, NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
});

test("no-doc-pointers reads the frontmatter and scripts of an Astro file, and not its markup", (t) => {
  const { stdout, status } = pointers(t, {
    "src/page.astro": "---\n// See: docs/time.md\nconst a = 1;\n---\n<p>// See: docs/time.md</p>\n<script>\n  // See: docs/time.md#why-utc\n</script>\n",
  });
  assert.equal(stdout, ["no-doc-pointers: 1 new findings.", `  src/page.astro has See: pointers on lines 2, 7. ${FIX}`, NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
});

test("no-doc-pointers records today's pointers with --init and fails one more", (t) => {
  const { cwd, stdout } = pointers(t, { "src/a.ts": "// See: docs/time.md\nexport const a = 1;\n// See: docs/time.md#why-utc\n" }, "--init");
  assert.equal(stdout, "no-doc-pointers: wrote 2 findings to .standard/baselines/no-doc-pointers.json\n");
  assert.deepEqual([standard(cwd, ["check", "no-doc-pointers"]).stdout, standard(cwd, ["check", "no-doc-pointers"]).status], ["no-doc-pointers: OK\n", 0]);
  write(cwd, { "src/b.ts": "// See: docs/time.md\nexport const b = 1;\n" });
  git(cwd, "add", "-A");
  const grown = standard(cwd, ["check", "no-doc-pointers"]);
  assert.match(grown.stdout, /^no-doc-pointers: 1 new findings\.\n {2}src\/b\.ts has a See: pointer on line 1\./);
  assert.equal(grown.status, 1);
});

test("a pin bump to 0.15.0 may put no-doc-pointers in pending", (t) => {
  const pinned = (version, pending) => ({
    "package.json": { devDependencies: { "@mapringg/standard": `github:mapringg/standard#v${version}` } },
    ".standard/config.json": { pending },
  });
  const repo = pullRequestRepo(t, { base: pinned("0.14.0", []), head: pinned("0.15.0", ["no-doc-pointers"]) });
  const { stdout, status } = checkEvent(t, repo.cwd, pullRequestEvent({ base: repo.base, head: repo.head }), ["baseline-growth"]);
  assert.deepEqual([stdout, status], ["baseline-growth: OK (#123)\n", 0]);
});
