import plugin from "./oxlint/rules.mjs";

/**
 * @typedef {import("./registry.mjs").Check} Check
 * @typedef {{ name: string, enforces: string, fix: string, config: readonly string[], since: string, baselineFree: boolean }} Row
 */

/** @type {(check: Check) => Row} */
function row(check) {
  return {
    name: check.name,
    enforces: check.doc.enforces,
    fix: check.doc.fix,
    config: check.doc.config,
    since: check.since,
    baselineFree: check.subject !== "tree" || check.baseline === false,
  };
}

/** @type {(keys: readonly string[], quote?: boolean) => string} */
const keys = (config, quote = false) => (config.length === 0 ? "none" : config.map((key) => (quote ? `\`${key}\`` : key)).join(", "));

/** @type {(checks: readonly Check[]) => string[]} One line per check. */
export function explainAll(checks) {
  const rows = checks.map(row);
  const width = Math.max(...rows.map((each) => each.name.length));
  return rows.map((each) => `${each.name.padEnd(width)}  ${each.since.padEnd(6)}  ${each.baselineFree ? "baseline-free" : "baseline    "}  config: ${keys(each.config)}  ${each.enforces} Fix: ${each.fix}`);
}

/** @type {() => { name: string, description: string, fix: string }[]} Each plugin rule as `standard/<id>`, the id allow takes. */
const pluginRules = () => Object.entries(plugin.rules).map(([id, rule]) => {
  const docs = /** @type {{ docs?: { description?: string, fix?: string } }} */ (rule.meta ?? {}).docs;
  return { name: `standard/${id}`, description: docs?.description ?? "", fix: docs?.fix ?? "" };
});

/** @type {() => string[]} One line per plugin rule. */
export function explainPlugin() {
  return pluginRules().map(({ name, description, fix }) => `${name} ${description} Fix: ${fix}`);
}

/** @type {(checks: readonly Check[], name: string) => string[]} */
export function explainOne(checks, name) {
  const rule = pluginRules().find((each) => each.name === name);
  if (rule) return [rule.name, `  Enforces: ${rule.description}`, `  Fix: ${rule.fix}`, "  Runs in: oxlint, through @mapringg/standard/oxlint", "  Baseline: none; allow takes its id"];
  const check = checks.find((each) => each.name === name);
  if (!check) throw new Error(`explain names "${name}", which is not a check or plugin rule in this version. Checks: ${[...checks.map((each) => each.name), ...pluginRules().map((each) => each.name)].join(", ")}.`);
  const each = row(check);
  return [
    each.name,
    `  Enforces: ${each.enforces}`,
    `  Fix: ${each.fix}`,
    `  Config: ${keys(each.config)}`,
    `  Since: ${each.since}`,
    `  Runs on: ${check.subject === "pr" ? "pull requests" : check.subject === "commit" ? "commits" : "the tree"}`,
    `  Baseline: ${each.baselineFree ? "none" : `.standard/baselines/${each.name}.json records today's findings, and the check fails only new ones`}`,
    `  Replaces: ${check.retired.length > 0 ? check.retired.join(", ") : "nothing"}`,
  ];
}

/** @type {(text: string) => string} */
const cell = (text) => text.replaceAll("|", "\\|");

/** @type {(checks: readonly Check[]) => string[]} The README's rule table. */
export function explainMarkdown(checks) {
  return [
    "| Check | Enforces | Fix | Config | Since | Baseline-free |",
    "| --- | --- | --- | --- | --- | --- |",
    ...checks.map(row).map((each) => `| \`${each.name}\` | ${cell(each.enforces)} | ${cell(each.fix)} | ${keys(each.config, true)} | ${each.since} | ${each.baselineFree ? "yes" : "no"} |`),
  ];
}
