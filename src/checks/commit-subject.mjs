import { GENERATED, subjectNotes } from "./support/subject-rules.mjs";

const PR_NUMBER = / \(#[1-9]\d*\)$/;

/**
 * @param {import("../subjects.mjs").Commit} commit
 * @returns {string[]}
 */
function messageNotes(commit) {
  if (commit.source !== "trunk" && GENERATED.test(commit.subject)) return [];
  const suffix = commit.source === "trunk" ? (commit.subject.match(PR_NUMBER)?.[0] ?? "") : "";
  const notes = subjectNotes(commit.subject.slice(0, commit.subject.length - suffix.length), suffix);
  if (commit.body.trim()) {
    notes.push("Commit has a body or trailer. Keep the subject line only, with no Co-Authored-By.");
  }
  return notes;
}

/**
 * @param {import("../subjects.mjs").Commit} commit
 * @returns {{ blocking: string[], advisory: string[] }}
 */
function notesBySource(commit) {
  const notes = messageNotes(commit);
  switch (commit.source) {
    case "message":
      return { blocking: notes, advisory: [] };
    case "branch":
      return {
        blocking: (commit.parents ?? 1) > 1
          ? ["Merge commit on a PR branch. Drop it and rebase onto the base branch instead."]
          : [],
        advisory: notes,
      };
    case "trunk":
      if (!PR_NUMBER.test(commit.subject)) {
        notes.push(
          "Squash subject must end with its PR number, for example (#194). Land the change by squash-merging its pull request.",
        );
      }
      if (commit.parents !== 1) notes.push("develop and main take one-parent squash commits only.");
      return { blocking: notes, advisory: [] };
  }
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "commit-subject",
  since: "0.1.0",
  doc: {
    enforces: "Each commit message is one subject line: a capital imperative verb, three or more words and at most 80 characters, with no prefix, trailing period, body or trailers. The commit-msg hook and a push to develop or main fail a broken subject, and a push also needs its pull request number. On a pull request a broken subject only warns, and a merge commit fails.",
    fix: "Reword the subject the finding names, drop the body and trailers, and rebase away merge commits.",
    config: [],
  },
  subject: "commit",
  retired: [
    "scripts/subject-convention.mjs",
    "scripts/check-commit-msg.mjs",
    "scripts/pr-commits.mjs",
    "scripts/check-pr-commits.mjs",
    "scripts/check-pr-commits.test.mjs",
    "scripts/check-main-commits.mjs",
  ],
  run(commit) {
    const key = commit.sha ? `${commit.sha.slice(0, 7)} ${commit.subject}` : commit.subject;
    const { blocking, advisory } = notesBySource(commit);
    return [
      ...blocking.map((fix) => ({ key, fix })),
      ...advisory.map((fix) => ({ key, fix, advisory: /** @type {const} */ (true) })),
    ];
  },
};
