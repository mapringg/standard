const MAX_SUBJECT = 80;
export const GENERATED = /^(Merge |fixup! |squash! |amend! )/;
const PREFIX = /^[a-z]+(\([^)]*\))?!?:\s/i;
const TICKET_ONLY = /^[a-z]+[-\s]?\d+$/i;
const NON_IMPERATIVE =
  /^(add(ed|ing)|fix(ed|ing)|updat(ed|ing)|chang(ed|ing)|implement(ed|ing)|refactor(ed|ing)|remov(ed|ing)|creat(ed|ing)|bump(ed|ing)|mak(es|ing)|wip)\b/i;

/**
 * @param {string} subject
 * @param {string} [squashSuffix]
 * @returns {string[]}
 */
export function subjectNotes(subject, squashSuffix = "") {
  if (!subject) return ["Subject is empty."];

  const notes = [];
  const length = subject.length + squashSuffix.length;
  if (length > MAX_SUBJECT) {
    notes.push(
      squashSuffix
        ? `Subject is ${length} characters with the "${squashSuffix}" the squash adds; keep it to ${MAX_SUBJECT} or fewer.`
        : `Subject is ${length} characters; keep it to ${MAX_SUBJECT} or fewer.`,
    );
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
