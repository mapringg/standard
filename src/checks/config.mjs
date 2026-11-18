import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, matchesGlob } from "node:path";
import { createRequire } from "node:module";
import { parseSync } from "oxc-parser";
import { excepted, findingPath } from "../rule-settings.mjs";

/** @param {import("../repo.mjs").Repo} repo */
function disabledPlugins(repo) {
  return repo.files().filter((path) => /(?:^|\/)(?:[^/]*\.)?oxlintrc\.json[c]?$|(?:^|\/)oxlint\.config\.[cm]?[jt]s$/.test(path)).flatMap((path) => {
    const text = repo.read(path);
    const { program, errors } = parseSync(path.endsWith("json") || path.endsWith("jsonc") ? `${path}.ts` : path, /jsonc?$/.test(path) ? `(${text}\n)` : text);
    if (errors.length) return [{ key: path, fix: "Cannot inspect oxlint config. Fix its syntax." }];
    const rules = new Set();
    /** @param {unknown} node */
    function visit(node) {
      if (!node || typeof node !== "object") return;
      const { type, key, value } = /** @type {{ type?: string, key?: { value?: string }, value?: { value?: unknown, elements?: { value?: unknown }[] } }} */ (node);
      const level = value?.elements?.[0]?.value ?? value?.value;
      if (type === "Property" && key?.value?.startsWith("standard/") && ["off", "allow", "warn", 0, 1].includes(/** @type {string | number} */ (level))) rules.add(key.value);
      Object.values(node).forEach(visit);
    }
    visit(program);
    return [...rules].map((rule) => ({ key: `${path} ${rule}`, fix: `Keep ${rule} at error in oxlint; put file exceptions in allow in .standard/config.json.` }));
  });
}

/** @param {import("../repo.mjs").Repo} repo @param {string[]} names @returns {import("../registry.mjs").Finding[]} */
function pluginFindings(repo, names) {
  const cache = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "verification", "standard");
  mkdirSync(cache, { recursive: true });
  const folder = mkdtempSync(join(cache, "config-"));
  try {
    const config = join(folder, "oxlint.json");
    writeFileSync(config, JSON.stringify({ jsPlugins: [join(import.meta.dirname, "../oxlint/rules.mjs")], categories: { correctness: "off" }, rules: Object.fromEntries(names.map((name) => [name, "error"])) }));
    const binary = existsSync(join(repo.root, "node_modules/.bin/oxlint")) ? join(repo.root, "node_modules/.bin/oxlint") : join(createRequire(import.meta.url).resolve("oxlint/package.json"), "../bin/oxlint");
    const result = spawnSync(binary, ["-c", config, "--disable-nested-config", "--no-ignore", "--format", "json", ...repo.files().filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !path.includes("node_modules/"))], { cwd: repo.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.error || ![0, 1].includes(result.status ?? -1)) throw new Error(`Cannot verify plugin exceptions: ${result.error?.message ?? result.stderr}`);
    const { diagnostics } = JSON.parse(result.stdout);
    return diagnostics.map((/** @type {{ filename: string, code: string }} */ diagnostic) => ({ key: `${diagnostic.filename} ${diagnostic.code.replace(/^standard\((.*)\)$/, "standard/$1")}`, fix: "" }));
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "config", since: "0.16.0", subject: "tree", baseline: false, retired: [],
  doc: { enforces: "Config uses known rule ids and every exception glob changes a finding.", fix: "Delete unused exceptions and keep plugin rules enabled in oxlint.", config: ["allow"] },
  applies: () => ({ on: true }),
  async run(repo, checks) {
    const files = repo.files();
    const findings = disabledPlugins(repo);
    const entries = Object.entries(repo.config.allow ?? {});
    const plugins = entries.map(([name]) => name).filter((name) => name.startsWith("standard/"));
    const raw = plugins.length ? pluginFindings(repo, plugins) : [];
    for (const [name, globs] of entries) {
      const check = checks.find((entry) => entry.name === name);
      const pending = repo.config.pending.includes(name);
      const results = name.startsWith("standard/") ? raw.filter(({ key }) => key.endsWith(` ${name}`)) : !pending && check?.subject === "tree" && check.applies(repo).on ? await check.run(repo, checks) : [];
      for (const [index, glob] of globs.entries()) {
        const without = { allow: { ...repo.config.allow, [name]: globs.filter((_, at) => at !== index) } };
        const changes = results.some((finding) => { const path = findingPath(finding, files); return excepted(repo.config, name, path) && matchesGlob(path, glob) && !excepted(without, name, path); });
        if (pending || !changes) findings.push({ key: `${name} ${glob}`, fix: pending ? `${name} is in skip; remove its exception.` : `${glob} ${files.some((file) => matchesGlob(file, glob)) ? "changes no findings" : "matches no files"}. Delete the exception glob.` });
      }
    }
    return findings;
  },
};
