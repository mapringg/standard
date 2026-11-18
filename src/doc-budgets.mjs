import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS } from "./doc-kinds.mjs";
import { loadCorpus } from "./checks/support/docs.mjs";

export const DOC_BUDGETS = ".standard/baselines/docs.json";

/** @param {import("./repo.mjs").Repo} repo @returns {import("./config.mjs").Budgets} */
export function readBudgets(repo) {
  if (!existsSync(join(repo.root, DOC_BUDGETS))) return {};
  const raw = JSON.parse(repo.read(DOC_BUDGETS));
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.entries(raw).some(([key, value]) => !KINDS.some(({ name }) => name === key) || !Number.isSafeInteger(value) || value < 0)) throw new Error(`${DOC_BUDGETS} must map doc kinds to non-negative line counts.`);
  return raw;
}

/** @param {import("./repo.mjs").Repo} repo @param {string} mode */
export function writeBudgets(repo, mode) {
  const before = readBudgets(repo);
  if (mode === "init" && existsSync(join(repo.root, DOC_BUDGETS))) throw new Error(`${DOC_BUDGETS} already exists; use --write to lower its budgets.`);
  const docs = [...loadCorpus(repo).docs.values()];
  const budgets = Object.fromEntries(KINDS.map(({ name }) => [name, docs.filter((doc) => doc.kind.name === name).reduce((sum, doc) => sum + doc.lines, 0)]));
  if (mode !== "init" && Object.entries(budgets).some(([key, value]) => value > (before[/** @type {import("./doc-kinds.mjs").KindName} */ (key)] ?? 0))) throw new Error(`${DOC_BUDGETS} budgets may only go down.`);
  mkdirSync(join(repo.root, ".standard/baselines"), { recursive: true });
  writeFileSync(join(repo.root, DOC_BUDGETS), JSON.stringify(budgets, null, 2) + "\n");
  return budgets;
}
