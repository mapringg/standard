#!/usr/bin/env node
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { items } from "./items.mjs";
import { githubSettings } from "./probes.mjs";

export const score = (paths, { remote = false } = {}) => {
  const repos = paths.map((path) => ({
    name: basename(resolve(path)),
    path: resolve(path),
    settings: remote ? githubSettings(path) : undefined,
  }));
  const probed = items.filter((item) => remote || !item.remote);
  const rows = probed.map(({ id, area, rule, probe }) => {
    const results = Object.fromEntries(repos.map((repo) => [repo.name, probe(repo, repos)]));
    return { id, area, rule, ok: Object.values(results).every((r) => r.ok), results };
  });
  return {
    repos: repos.map((r) => r.name),
    rows,
    skipped: items.length - probed.length,
    passing: rows.filter((row) => row.ok).length,
  };
};

const formatText = ({ repos, rows, skipped, passing }) => {
  const width = Math.max(...rows.map((row) => row.id.length));
  const cols = repos.map((name) => Math.max(name.length, 4));
  const line = (first, cells) => [first.padEnd(width), ...cells.map((c, i) => c.padEnd(cols[i]))].join("  ").trimEnd();
  const out = [line("item", repos)];
  let area;
  for (const row of rows) {
    if (row.area !== area) out.push("", `[${(area = row.area)}]`);
    out.push(line(row.id, repos.map((name) => (row.results[name].ok ? "ok" : "fail"))));
  }
  const failing = rows.filter((row) => !row.ok);
  if (failing.length) out.push("", "failures:");
  for (const row of failing) {
    out.push("", `${row.id}: ${row.rule}`);
    const failed = repos.filter((name) => !row.results[name].ok);
    const byDetail = Map.groupBy(failed, (name) => row.results[name].detail);
    for (const [detail, names] of byDetail) out.push(names.length === repos.length ? `  ${detail}` : `  ${names.join(", ")}: ${detail}`);
  }
  if (skipped) out.push("", `skipped ${skipped} GitHub setting items; pass --remote to probe them`);
  out.push("", `${passing} of ${rows.length} items pass in every repo`);
  return out.join("\n");
};

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { remote: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  if (positionals.length === 0) {
    console.error("usage: node score/score.mjs [--remote] [--json] <repo>...");
    process.exit(2);
  }
  const result = score(positionals, values);
  console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result));
  process.exitCode = result.passing === result.rows.length ? 0 : 1;
}
