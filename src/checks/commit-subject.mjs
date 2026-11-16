const MAX_SUBJECT = 80;
const GENERATED = /^(Merge |fixup! |squash! |amend! )/;
const PREFIX = /^[a-z]+(\([^)]*\))?!?:\s/i;
const TICKET_ONLY = /^[a-z]+[-\s]?\d+$/i;
const NON_IMPERATIVE =
  /^(add(ed|ing)|fix(ed|ing)|updat(ed|ing)|chang(ed|ing)|implement(ed|ing)|refactor(ed|ing)|remov(ed|ing)|creat(ed|ing)|bump(ed|ing)|mak(es|ing)|wip)\b/i;
const PR_NUMBER = / \(#[1-9]\d*\)$/;

/**
 * @param {string} subject
 * @returns {string[]}
 */
function subjectNotes(subject) {
  if (!subject) return ["Subject is empty."];

  const notes = [];
  if (subject.length > MAX_SUBJECT) {
    notes.push(`Subject is ${subject.length} characters; keep it to ${MAX_SUBJECT} or fewer.`);
  }
  if (PREFIX.test(subject)) {
    notes.push(`Subject carries a "${subject.split(":")[0]}:" prefix. Drop it.`);
  }
  if (TICKET_ONLY.test(subject)) {
    notes.push(
      `Subject "${subject}" is only a ticket id. Say what the change accomplishes; the ticket goes in the PR body.`,
    );
  }
  if (subject.endsWith(".")) {
    notes.push("Subject ends with a period. Drop it.");
  }
  if (subject[0] !== subject[0].toUpperCase()) {
    notes.push("Subject does not start with a capital letter.");
  }
  if (NON_IMPERATIVE.test(subject)) {
    notes.push(
      `Subject starts with "${subject.split(/\s/)[0]}". Use the imperative: "Fix ...", not "Fixed ..." or "Fixing ...".`,
    );
  }
  if (subject.split(/\s+/).length < 3) {
    notes.push("Subject is too short to describe the change.");
  }
  return notes;
}

/**
 * @param {import("../subjects.mjs").Commit} commit
 * @returns {string[]}
 */
function messageNotes(commit) {
  if (GENERATED.test(commit.subject)) return [];
  const notes = subjectNotes(commit.subject);
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
