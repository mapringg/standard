import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";

import { loadRepo } from "../src/repo.mjs";
import { commit, git, tempDir, tempRepo } from "./helpers.mjs";

test("a worktree has the main checkout's name and its own root", (t) => {
  const main = tempRepo(t);
  commit(main, "Start the repository");
  const worktree = join(tempDir(t, "worktree"), "feature");
  git(main, "worktree", "add", "-q", "-b", "feature", worktree);
  mkdirSync(join(worktree, "src"));

  const repo = loadRepo(join(worktree, "src"));
  assert.equal(repo.name, basename(main));
  assert.equal(basename(repo.root), "feature");
  assert.equal(loadRepo(main).name, basename(main));
});

test("files lists tracked paths, narrowed by a glob, and read returns their text", (t) => {
  const cwd = tempRepo(t, { pending: [], pr: {}, banned: [] });
  mkdirSync(join(cwd, "src/checks"), { recursive: true });
  writeFileSync(join(cwd, "src/checks/a.mjs"), "export default 1;\n");
  writeFileSync(join(cwd, "src/b.mjs"), "");
  writeFileSync(join(cwd, "untracked.mjs"), "");
  git(cwd, "add", ".standard", "src");

  const repo = loadRepo(cwd);
  assert.deepEqual(repo.files(), [".standard/config.json", "src/b.mjs", "src/checks/a.mjs"]);
  assert.deepEqual(repo.files("src/*.mjs"), ["src/b.mjs"]);
  assert.deepEqual(repo.files("**/*.mjs"), ["src/b.mjs", "src/checks/a.mjs"]);
  assert.equal(repo.read("src/checks/a.mjs"), "export default 1;\n");
  assert.deepEqual(repo.config, { hooks: { "pre-commit": [], "pre-push": [] }, pending: [], pr: {}, boundaries: { modules: [], forbid: [] }, banned: [], effectWrappers: [], clientData: [], apiModules: [], cachedModules: [], errorBoundaries: [], budgets: {} });
});
