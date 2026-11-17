import { subjectNotes } from "./support/subject-rules.mjs";

/** @type {import("../registry.mjs").Check} */
export default {
  name: "pr-title",
  since: "0.2.0",
  doc: {
    enforces: "The pull request title follows the commit subject rules, counting the ` (#<number>)` the squash adds.",
    fix: "Retitle the pull request, since the title becomes the squash commit's subject.",
    config: [],
  },
  subject: "pr",
  retired: ["scripts/check-pr-convention.mjs", "scripts/check-pr-convention.test.mjs", "scripts/subject-convention.mjs"],
  run(pr) {
    return subjectNotes(pr.title, ` (#${pr.number})`).map((note) => ({
      key: pr.title,
      fix: `${note} The title becomes the squash commit's subject, which the push to develop checks.`,
    }));
  },
};
