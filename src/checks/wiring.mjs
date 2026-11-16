import { PROBES } from "../wiring.mjs";

/** @type {import("../registry.mjs").Check} */
export default {
  name: "wiring",
  since: "0.4.0",
  subject: "tree",
  baseline: false,
  retired: [],
  applies: () => ({ on: true }),
  run(repo, checks) {
    return PROBES.flatMap((probe) => probe.run(repo, checks));
  },
};
