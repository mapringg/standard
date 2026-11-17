import { PROBES } from "../wiring.mjs";

/** @type {import("../registry.mjs").Check} */
export default {
  name: "wiring",
  since: "0.4.0",
  doc: {
    enforces: "The repository runs the standard: a CI Check job runs `standard check`, `package.json` pins the package exactly, the install matches the pin, `prepare` runs `standard install`, git tracks `.standard/config.json`, `CLAUDE.md` is `@AGENTS.md` when present, and git tracks no script a check retires unless that check is pending. `standard score`, not this check, reads the installed hooks.",
    fix: "Make the change the probe names, such as deleting a retired script.",
    config: ["pending"],
  },
  subject: "tree",
  baseline: false,
  retired: [],
  applies: () => ({ on: true }),
  run(repo, checks) {
    return PROBES.flatMap((probe) => probe.run(repo, checks));
  },
};
