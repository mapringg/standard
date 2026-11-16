import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (repo, path) => {
  const file = join(repo.path, path);
  return existsSync(file) ? readFileSync(file) : null;
};

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 12);

export const sameAcross = (path) => ({
  id: path,
  rule: `${path} is identical in every repo`,
  probe(repo, repos) {
    const hashes = new Map(repos.map((r) => [r.name, read(r, path) && sha256(read(r, path))]));
    const mine = hashes.get(repo.name);
    const ok = mine !== null && new Set(hashes.values()).size === 1;
    const groups = Map.groupBy(hashes.keys(), (name) => hashes.get(name) ?? "missing");
    const detail = [...groups].map(([hash, names]) => `${names.join(", ")}: ${hash}`).join("; ");
    return { ok, detail };
  },
});

export const present = (pattern) => ({
  id: pattern,
  rule: `${pattern} exists`,
  probe(repo) {
    const ok = globSync(pattern, { cwd: repo.path }).length > 0;
    return { ok, detail: ok ? "present" : "missing" };
  },
});

export const exact = (path, content) => ({
  id: path,
  rule: `${path} is exactly ${JSON.stringify(content)}`,
  probe(repo) {
    const actual = read(repo, path)?.toString();
    if (actual === undefined) return { ok: false, detail: "missing" };
    return { ok: actual === content, detail: `is ${JSON.stringify(actual)}` };
  },
});

export const untracked = (path) => ({
  id: `untracked ${path}`,
  rule: `${path} is not tracked by git`,
  probe(repo) {
    const listed = execFileSync("git", ["-C", repo.path, "ls-files", "--", path], { encoding: "utf8" }).trim();
    return { ok: listed === "", detail: listed ? `tracked: ${listed.split("\n").join(", ")}` : "untracked" };
  },
});

export const scriptRuns = (scriptName, needle) => ({
  id: `${scriptName} runs ${needle}`,
  rule: `package.json script ${scriptName} runs ${needle}`,
  probe(repo) {
    const pkg = read(repo, "package.json");
    const script = pkg && JSON.parse(pkg).scripts?.[scriptName];
    if (!script) return { ok: false, detail: `no ${scriptName} script` };
    return { ok: script.includes(needle), detail: `${scriptName} is ${JSON.stringify(script)}` };
  },
});

const ciPath = ".github/workflows/ci.yml";

export const ciRuns = (needle) => ({
  id: `ci runs ${needle}`,
  rule: `${ciPath} runs ${needle}`,
  probe(repo) {
    const ci = read(repo, ciPath)?.toString();
    if (ci === undefined) return { ok: false, detail: `no ${ciPath}` };
    const ok = ci.includes(needle);
    return { ok, detail: ok ? "found" : `${needle} not in ${ciPath}` };
  },
});

export const setting = (name, expected) => ({
  id: `${name} ${expected}`,
  rule: `GitHub setting ${name} is ${expected}`,
  remote: true,
  probe(repo) {
    const actual = repo.settings[name];
    return { ok: actual === expected, detail: `is ${JSON.stringify(actual)}` };
  },
});

export const githubSettings = (repoPath) => {
  const url = execFileSync("git", ["-C", repoPath, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const [, slug] = url.match(/github\.com[:/](.+?)(?:\.git)?$/) ?? [];
  if (!slug) throw new Error(`${repoPath}: origin ${url} is not a GitHub remote`);
  return JSON.parse(execFileSync("gh", ["api", `repos/${slug}`], { encoding: "utf8" }));
};
