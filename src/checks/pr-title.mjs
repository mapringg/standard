import { subjectNotes } from "./support/subject-rules.mjs";

const SELF_TITLED = ["dependabot[bot]"];

/** @type {import("../registry.mjs").Check} */
export default {
  name: "pr-title",
  since: "0.2.0",
  subject: "pr",
  retired: ["scripts/check-pr-convention.mjs", "scripts/check-pr-convention.test.mjs"],
  run(pr) {
    const advisory = SELF_TITLED.includes(pr.author);
    return subjectNotes(pr.title, ` (#${pr.number})`).map((note) => ({
      key: pr.title,
      fix: `${note} The title becomes the squash commit's subject.`,
      ...(advisory ? { advisory: /** @type {const} */ (true) } : {}),
    }));
  },
};
