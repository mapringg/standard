import { PROBES } from "../wiring.mjs";

/** @type {import("../registry.mjs").Check} */
export default {
  name: "wiring",
  since: "0.4.0",
  doc: {
    enforces: "The repository runs the standard: CI, pin, install, `prepare`, config file, `CLAUDE.md`, hooks, and no script a check retires.",
    fix: "Make the change the probe names, such as deleting a retired script.",
    config: [],
  },
  subject: "tree",
  baseline: false,
  retired: [],
  applies: () => ({ on: true }),
  run(repo, checks) {
    return PROBES.flatMap((probe) => probe.run(repo, checks));
  },
};
