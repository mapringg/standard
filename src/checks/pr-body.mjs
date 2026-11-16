import { FILE } from "../config.mjs";
import { evidenceLines, proseLines, rendered } from "./support/markdown.mjs";

const MIN_BODY = 120;
const REQUIRED_HEADINGS = ["Summary", "Evidence", "Merge Danger"];
const BEFORE_AFTER = /\*\*before:?\*\*[\s\S]*\*\*after:?\*\*/i;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
const DOOR = /\*\*door:?\*\*:?\s*(one|two)-way\b/i;
const BLAST_RADIUS = /\*\*blast radius:?\*\*:?\s*(\S[^\n]*)/i;
const TEMPLATE_PLACEHOLDER = /<(screenshot\/output|one-way or two-way|one-word description)[^>]*>/i;
const TICKET_LINE = /^ticket\s*:/i;

/**
 * @param {string[]} lines
 */
function hasBeforeAfterTable(lines) {
  return lines.some((line, i) => {
    if (!TABLE_DELIMITER.test(lines[i + 1] ?? "")) return false;
    const columns = line.split("|").map((cell) => cell.replace(/\*/g, "").trim().toLowerCase());
    return columns.includes("before") && columns.includes("after");
  });
}

/**
 * @param {string} body
 * @param {string | undefined} prefix
 * @returns {string | null}
 */
function ticketNote(body, prefix) {
  const lines = proseLines(body);
  const at = lines.findIndex((line) => line !== null && TICKET_LINE.test(line.trim()));
  if (at === -1) return null;
  const line = /** @type {string} */ (lines[at]).trim();
  if (!prefix) {
    return `Description has a "${line}" line, but ${FILE} sets no pr.ticket-prefix, so this repo has no tickets. Delete the line.`;
  }
  if (!new RegExp(`^Ticket: ${prefix}-[1-9]\\d*$`).test(line)) {
    return `"${line}" is not a ticket line. Write "Ticket: ${prefix}-123", or delete the line when there is no ticket.`;
  }
  if (at !== 0) return `"${line}" is not the description's first line. Move it there.`;
  return null;
}

/**
 * @param {string} body
 * @param {string | undefined} prefix
 * @returns {{ key: string, fix: string }[]}
 */
function bodyNotes(body, prefix) {
  if (!body) return [{ key: "description", fix: "Description is empty. Fill in the pull request template." }];

  /** @type {{ key: string, fix: string }[]} */
  const notes = [];
  if (body.length < MIN_BODY) {
    notes.push({
      key: "description",
      fix: `Description is ${body.length} characters of real content; write at least ${MIN_BODY}.`,
    });
  }
  for (const heading of REQUIRED_HEADINGS) {
    if (!new RegExp(`^#{1,4}\\s*${heading}\\b`, "im").test(body)) {
      notes.push({ key: heading, fix: `Description has no "## ${heading}" section.` });
    }
  }
  const evidence = evidenceLines(body);
  if (!BEFORE_AFTER.test(evidence.join("\n")) && !hasBeforeAfterTable(evidence)) {
    notes.push({
      key: "Evidence",
      fix: 'Evidence has no "**Before:**" / "**After:**" pair and no table with Before and After columns.',
    });
  }
  if (!DOOR.test(body)) {
    notes.push({ key: "Door", fix: 'Merge Danger has no "**Door:** one-way" or "**Door:** two-way".' });
  }
  const radius = BLAST_RADIUS.exec(body)?.[1];
  if (!radius) {
    notes.push({ key: "Blast Radius", fix: 'Merge Danger has no "**Blast Radius:**".' });
  } else if (radius.split(".")[0].trim().split(/\s+/).length > 1) {
    notes.push({
      key: "Blast Radius",
      fix: `Blast Radius "${radius.split(".")[0].trim()}" is more than one word. Name the area in one word, then describe the risk below it.`,
    });
  }
  if (TEMPLATE_PLACEHOLDER.test(body)) {
    notes.push({ key: "placeholder", fix: "Description still carries a template placeholder. Replace it." });
  }
  const ticket = ticketNote(body, prefix);
  if (ticket) notes.push({ key: "Ticket", fix: ticket });
  return notes;
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "pr-body",
  since: "0.2.0",
  subject: "pr",
  retired: ["scripts/check-pr-convention.mjs", "scripts/check-pr-convention.test.mjs", "scripts/subject-convention.mjs"],
  run(pr, repo) {
    return bodyNotes(rendered(pr.body), repo.config.pr["ticket-prefix"]).map((note) => ({
      ...note,
      advisory: /** @type {const} */ (true),
    }));
  },
};
