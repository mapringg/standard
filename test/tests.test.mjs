import assert from "node:assert/strict";
import { test } from "node:test";

import { git, standard, tempRepo, WIRED, write } from "./helpers.mjs";

const CI = WIRED[".github/workflows/ci.yml"];
const HOOKS = 'hooks.pre-push: Add "pnpm test" to hooks.pre-push in .standard/config.json, so a push that fails a test stops before CI.';
const STEP = 'ci: Run "pnpm test" in a step of the Check job that has no continue-on-error, so a pull request that fails a test cannot merge.';

function tests(t, files) {
  const cwd = tempRepo(t);
  write(cwd, Object.fromEntries(Object.entries({ ...WIRED, ...files }).filter(([, content]) => content !== null)));
  git(cwd, "add", "-A");
  return standard(cwd, ["check", "tests"]);
}

function passes(t, files) {
  const { stdout, status } = tests(t, files);
  assert.deepEqual([stdout, status], ["tests: OK\n", 0]);
}

function fails(t, files, ...lines) {
  const { stdout, status } = tests(t, files);
  assert.equal(stdout, lines.map((line) => `tests: ${line}\n`).join(""));
  assert.equal(status, 1);
}

const manifest = (scripts) => ({ name: "pkg", ...(scripts ? { scripts } : {}) });

test("tests passes a repository whose test command runs in pre-push and CI", (t) => {
  passes(t, {});
});

test("tests wants a test script at the root", (t) => {
  fails(
    t,
    { "package.json": { ...WIRED["package.json"], scripts: { prepare: "standard install" } } },
    'package.json scripts.test: Add a test script such as "turbo run test" to package.json, so CI and pre-push have one command to run.',
  );
});

test("tests wants a test script in each package that holds a test file, and names a file it would skip", (t) => {
  fails(
    t,
    {
      "test/root.test.mjs": "",
      "apps/api/package.json": manifest(),
      "apps/api/src/a.spec.ts": "",
      "apps/api/src/b.test.ts": "",
      "apps/web/package.json": manifest({ test: "vitest run" }),
      "apps/web/src/c.test.tsx": "",
      "packages/ui/package.json": manifest(),
      "packages/ui/src/button.tsx": "",
      "packages/ui/src/button.stories.tsx": "",
      "packages/db/package.json": manifest({ build: "tsc" }),
      "packages/db/test/schema.test.cjs": "",
    },
    "apps/api/package.json scripts.test: Add a test script to apps/api/package.json, since turbo run test skips a package without one and so never runs apps/api/src/a.spec.ts.",
    "packages/db/package.json scripts.test: Add a test script to packages/db/package.json, since turbo run test skips a package without one and so never runs packages/db/test/schema.test.cjs.",
  );
});

test("tests wants pre-push to run the test command as a whole command", (t) => {
  const hook = (line) => ({ ".standard/config.json": { hooks: { "pre-push": [line] } } });
  for (const line of ["pnpm test", " pnpm run test "]) passes(t, hook(line));
  for (const line of ["pnpm lint && pnpm test", "pnpm test:visual", "pnpm turbo run test", 'echo "pnpm test"', "pnpm test || true", "pnpm test; true"]) {
    fails(t, hook(line), HOOKS);
  }
  fails(t, { ".standard/config.json": {} }, HOOKS);
});

test("tests wants a Check job step that runs the test command without continue-on-error", (t) => {
  const step = (lines) => ({ ".github/workflows/ci.yml": CI.replace("      - run: pnpm test\n", lines) });
  passes(t, step("      - if: github.event.pull_request.draft == false\n        run: pnpm run test\n"));
  for (const lines of [
    "",
    "      - run: pnpm turbo run test\n",
    "      - run: pnpm test:visual\n",
    "      - run: pnpm test\n        continue-on-error: true\n",
    "      - run: pnpm test\n        shell: bash\n",
  ]) {
    fails(t, step(lines), STEP);
  }
});

test("tests leaves a repository without a Check job to the ci probe", (t) => {
  passes(t, { ".github/workflows/ci.yml": null });
});

test("tests keeps no baseline, pending holds it off, and it skips a repository without a package.json", (t) => {
  const broken = { "package.json": null, ".standard/config.json": {} };
  assert.equal(tests(t, broken).stdout, "tests: skipped, git tracks no package.json\n");
  const pending = tests(t, { ".standard/config.json": { pending: ["tests"] } });
  assert.deepEqual([pending.stdout, pending.status], ["tests: pending in .standard/config.json, so it did not run\n", 0]);
  const cwd = tempRepo(t);
  write(cwd, WIRED);
  git(cwd, "add", "-A");
  assert.match(standard(cwd, ["check", "tests", "--init"]).stderr, /tests allows no findings, so it has no baseline for --init/);
});
