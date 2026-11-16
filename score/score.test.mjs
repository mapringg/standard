import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { items } from "./items.mjs";

const cli = join(import.meta.dirname, "score.mjs");

const fixture = (files) => {
  const repo = mkdtempSync(join(tmpdir(), "score-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  execFileSync("git", ["init", "-q", repo]);
  return repo;
};

const run = (...repos) => {
  const { status, stdout } = spawnSync(process.execPath, [cli, "--json", ...repos], { encoding: "utf8" });
  return { status, result: JSON.parse(stdout) };
};

const row = (result, id) => result.rows.find((r) => r.id === id);

const cleanFiles = () => {
  const files = {
    "package.json": JSON.stringify({
      scripts: { "lint:repo": "node scripts/check-duplicates.mjs && node scripts/check-dead-code.mjs && node scripts/check-conventions.mjs" },
    }),
    ".github/workflows/ci.yml": items.filter((i) => i.id.startsWith("ci runs ")).map((i) => i.id.slice(8)).join("\n"),
    "CLAUDE.md": "@AGENTS.md\n",
    ".claude/skills/verify-app/features/README.md": "",
  };
  for (const item of items) if (!/[ *]/.test(item.id)) files[item.id] ??= item.id;
  return files;
};

test("identical repos pass every local item and exit 0", () => {
  const { status, result } = run(fixture(cleanFiles()), fixture(cleanFiles()));
  assert.deepEqual(result.rows.filter((r) => !r.ok).map((r) => r.id), []);
  assert.equal(result.skipped, 7);
  assert.equal(status, 0);
});

test("a drifted shared file fails and its detail names the repos per hash", () => {
  const path = "scripts/ratchet.mjs";
  const a = fixture(cleanFiles());
  const b = fixture(cleanFiles());
  const c = fixture({ ...cleanFiles(), [path]: "drifted" });
  const { status, result } = run(a, b, c);
  const drift = row(result, path);
  assert.equal(drift.ok, false);
  const [nameA, nameB, nameC] = result.repos;
  assert.match(drift.results[nameA].detail, new RegExp(`${nameA}, ${nameB}: [0-9a-f]+; ${nameC}: [0-9a-f]+`));
  assert.equal(status, 1);
});

test("a shared file missing from one repo fails and names that repo as missing", () => {
  const path = ".nvmrc";
  const files = cleanFiles();
  delete files[path];
  const { status, result } = run(fixture(cleanFiles()), fixture(files));
  const missing = row(result, path);
  assert.equal(missing.ok, false);
  assert.match(missing.results[result.repos[1]].detail, new RegExp(`${result.repos[1]}: missing`));
  assert.equal(status, 1);
});

test("a missing present file fails only in the repo that lacks it", () => {
  const files = cleanFiles();
  delete files["docs/checks.md"];
  const { result } = run(fixture(cleanFiles()), fixture(files));
  const missing = row(result, "docs/checks.md");
  assert.equal(missing.results[result.repos[0]].ok, true);
  assert.equal(missing.results[result.repos[1]].ok, false);
});

test("a glob present item passes on any match and fails with none", () => {
  const files = cleanFiles();
  delete files[".claude/skills/verify-app/features/README.md"];
  const { result } = run(fixture(cleanFiles()), fixture(files));
  const glob = row(result, ".claude/skills/verify-*/features/README.md");
  assert.deepEqual(result.repos.map((name) => glob.results[name].ok), [true, false]);
});

test("untracked fails once the path is committed", () => {
  const repo = fixture({ ...cleanFiles(), ".verify-artifacts/shot.png": "png" });
  const before = row(run(repo).result, "untracked .verify-artifacts");
  execFileSync("git", ["-C", repo, "add", ".verify-artifacts"]);
  const after = run(repo);
  assert.equal(Object.values(before.results)[0].ok, true);
  assert.equal(Object.values(row(after.result, "untracked .verify-artifacts").results)[0].ok, false);
  assert.equal(after.status, 1);
});

test("CLAUDE.md must be exactly the AGENTS.md import", () => {
  const { result } = run(fixture({ ...cleanFiles(), "CLAUDE.md": "@AGENTS.md" }));
  assert.equal(row(result, "CLAUDE.md").ok, false);
});

test("lint:repo must run each named check", () => {
  const files = { ...cleanFiles(), "package.json": JSON.stringify({ scripts: { "lint:repo": "node scripts/check-duplicates.mjs" } }) };
  const { result } = run(fixture(files));
  assert.equal(row(result, "lint:repo runs check-duplicates.mjs").ok, true);
  assert.equal(row(result, "lint:repo runs check-dead-code.mjs").ok, false);
});

test("text output prints cells per repo and the pass count last", () => {
  const files = cleanFiles();
  delete files["knip.json"];
  const a = fixture(cleanFiles());
  const b = fixture(files);
  const { status, stdout } = spawnSync(process.execPath, [cli, a, b], { encoding: "utf8" });
  const lines = stdout.trimEnd().split("\n");
  assert.match(lines.find((l) => l.startsWith("knip.json")), /^knip\.json\s+ok\s+fail$/);
  assert.match(stdout, /knip\.json: knip\.json exists\n {2}score-\w+: missing/);
  const total = items.filter((i) => !i.remote).length;
  assert.equal(lines.at(-1), `${total - 1} of ${total} items pass in every repo`);
  assert.equal(status, 1);
});
