import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PACKAGE = join(import.meta.dirname, "..");
const OXLINT = join(PACKAGE, "node_modules/.bin/oxlint");

const FRAMEWORK = { api: "hono", web: "next", liff: "vite", mobile: "expo", marketing: "astro" };

function scaffold(files) {
  const apps = new Set(
    Object.keys(files)
      .filter((path) => path.startsWith("apps/"))
      .map((path) => path.split("/")[1]),
  );
  const extra = {};
  for (const app of apps) {
    if (FRAMEWORK[app])
      extra[`apps/${app}/package.json`] = JSON.stringify({ dependencies: { [FRAMEWORK[app]]: "1.0.0" } });
  }
  return extra;
}

export function lint(t, files, eventPath) {
  const root = mkdtempSync(join(tmpdir(), "standard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const modules = join(PACKAGE, "node_modules");
  const localModules = join(root, "node_modules");
  if (Object.keys(files).some((file) => file.startsWith("node_modules/@mapringg/"))) {
    mkdirSync(localModules);
    for (const name of readdirSync(modules)) {
      if (name !== "@mapringg") symlinkSync(join(modules, name), join(localModules, name));
    }
  } else {
    symlinkSync(modules, localModules);
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify({ extends: [join(PACKAGE, "oxlint.json")] }));
  for (const [path, text] of Object.entries({ ...scaffold(files), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const result = spawnSync(OXLINT, ["-f", "json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: eventPath ? "pull_request" : "", GITHUB_EVENT_PATH: eventPath ?? "" },
  });
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

export function crashes(diagnostics) {
  return diagnostics.filter((item) => item.message.startsWith("Error running JS plugin"));
}
