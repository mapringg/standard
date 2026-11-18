import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PACKAGE = join(import.meta.dirname, "..");
const OXLINT = join(PACKAGE, "node_modules/.bin/oxlint");

export function lint(t, files) {
  const root = mkdtempSync(join(tmpdir(), "standard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify({ extends: [join(PACKAGE, "oxlint.json")] }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const result = spawnSync(OXLINT, ["-f", "json"], { cwd: root, encoding: "utf8" });
  const parsed = JSON.parse(result.stdout || "{}");
  if (!parsed.diagnostics) throw new Error(result.stderr || result.stdout);
  return parsed.diagnostics.map((item) => ({ file: item.filename, rule: item.code, message: item.message }));
}

export function only(diagnostics, rule) {
  return diagnostics.filter((item) => item.rule === `standard(${rule})`);
}

export function filesWith(diagnostics, rule) {
  return [...new Set(only(diagnostics, rule).map((item) => item.file))].sort();
}
