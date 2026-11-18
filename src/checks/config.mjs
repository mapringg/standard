import { matchesGlob } from "node:path";
import { findingSeverity } from "../rule-settings.mjs";

/** @type {import("../registry.mjs").Check} */
export default {
  name: "config", since: "0.16.0", subject: "tree", baseline: false, retired: [],
  doc: { enforces: "Config uses known rule ids and every override glob changes a finding.", fix: "Delete unused overrides or correct their globs and severities.", config: ["rules", "overrides"] },
  applies: () => ({ on: true }),
  async run(repo, checks) {
    const files = repo.files();
    const findings = [];
    const cache = new Map();
    for (const [index, override] of (repo.config.overrides ?? []).entries()) {
      for (const [globIndex, glob] of override.files.entries()) {
        const matched = files.filter((file) => matchesGlob(file, glob));
        let changes = false;
        const without = { ...repo.config, overrides: repo.config.overrides?.map((entry, at) => at === index ? { ...entry, files: entry.files.filter((_, at) => at !== globIndex) } : entry) };
        for (const name of Object.keys(override.rules)) {
          const check = checks.find((entry) => entry.name === name);
          if (!check || check.name === "config" || check.subject !== "tree" || !check.applies(repo).on) continue;
          if (!cache.has(name)) cache.set(name, await check.run(repo, checks));
          changes ||= cache.get(name).some((/** @type {import("../registry.mjs").Finding} */ finding) =>
            findingSeverity(repo.config, name, finding, files) !== findingSeverity(without, name, finding, files));
        }
        if (!changes) findings.push({ key: `override ${index} ${glob}`, fix: matched.length ? `${glob} changes no findings. Delete the override glob.` : `${glob} matches no files. Delete the override glob.` });
      }
    }
    return findings;
  },
};
