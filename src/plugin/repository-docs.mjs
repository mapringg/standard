import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classify } from "./markdown-lines.mjs";
import { listFiles } from "./paths.mjs";

const TITLE = /^# [^#\s].*$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const BULLET = /^- \S/;
const QUICK_START = "## Quick start";
const VISIBLE_LIMIT = 100;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const LINKS =
  /!?\[([^\]\n]+)\](?:\(\s*(?:<[^>\n]*>|[^\s()]*(?:\([^()\n]*\)[^\s()]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)|\[[^\]\n]*\])/g;

const CODE_SPAN = /(`+)([^\n]*?)\1/g;

function visibleLength(text) {
  const code = [];
  const prose = text
    .replace(CODE_SPAN, (_, _fence, value) => {
      code.push(value);
      return "\u0000";
    })
    .replace(LINKS, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1/g, "$2");
  let index = 0;
  return Array.from(SEGMENTER.segment(prose.replaceAll("\u0000", () => code[index++]).trim())).length;
}

function checkLength(text, line, report) {
  const length = visibleLength(text);
  if (length > VISIBLE_LIMIT) report(line, "Shorten this text to 100 visible characters (currently " + length + ").");
}

function checkAgents(lines, report) {
  if (lines[0]?.line !== "# AGENTS.md") report(1, "Start with # AGENTS.md.");
  let section = null;
  for (const { line, kind, number } of lines.slice(1)) {
    if (!line.trim() || kind === "generated") continue;
    if (line === "## Rules" && section === null) {
      section = "Rules";
      continue;
    }
    if (line === "## Sources" && section !== "Sources") {
      section = "Sources";
      continue;
    }
    if (section && kind === "prose" && BULLET.test(line)) checkLength(line.slice(2), number, report);
    else report(number, "Use ## Rules and optional ## Sources with flat, single-line bullets.");
  }
  if (!section) report(1, "Add ## Rules or ## Sources with a scoped instruction.");
}

function checkReadme(lines, report) {
  const title = lines[0]?.line ?? "";
  if (!TITLE.test(title) || /^# README(?:\.md)?\s*$/i.test(title))
    report(1, "Start with a # heading naming the project.");
  const start = lines.findIndex(({ line, kind }) => kind === "prose" && line === QUICK_START);
  if (start < 0) report(1, "Add ## Quick start after the overview.");
  const before = lines.slice(1, start < 0 ? undefined : start);
  const overview = before
    .map(({ line }) => line)
    .join("\n")
    .trim();
  if (
    !overview ||
    /\n[ \t]*\n/.test(overview) ||
    before.some(({ line, kind }) => kind !== "prose" || BULLET.test(line) || HEADING.test(line))
  )
    report(2, "Give the project a single overview paragraph below its title.");

  let paragraph = [];
  let first = 1;
  for (const { line, kind, number } of lines.slice(1)) {
    const structural = kind !== "prose" || !line.trim() || HEADING.test(line) || line.startsWith("|");
    const bullet = /^(?:[-*+]|\d+[.)])\s+/.exec(line);
    if (structural || bullet) {
      checkLength(paragraph.join(" "), first, report);
      paragraph = [];
    }
    if (HEADING.test(line) && kind === "prose" && number !== start + 1)
      report(number, "Use ## Quick start as the sole README section.");
    if (structural) continue;
    if (!paragraph.length) first = number;
    paragraph.push(line.slice(bullet?.[0].length ?? 0).trim());
  }
  checkLength(paragraph.join(" "), first, report);
  if (start >= 0 && !lines.slice(start + 1).some(({ line }) => line.trim()))
    report(start + 1, "Add the steps to get started.");
}

export function repositoryDocProblems(root) {
  const files = listFiles(root).filter((file) => !file.startsWith("vendor/"));
  const findings = [];
  for (const required of ["README.md", "AGENTS.md"])
    if (!files.includes(required)) findings.push(required + ":1: Add this file at the repository root.");

  for (const file of files) {
    const agents = /(?:^|\/)AGENTS\.md$/.test(file);
    if (!agents && !/(?:^|\/)README\.md$/i.test(file)) continue;
    const report = (line, message) => findings.push(file + ":" + line + ": " + message);
    if (!agents && file !== "README.md") {
      report(1, "Keep the repository's README.md at the root.");
      continue;
    }
    const lines = classify(readFileSync(join(root, file), "utf8")).map((item, index) => ({
      ...item,
      number: index + 1,
    }));
    for (const { line, kind, number } of lines)
      if (kind === "prose" && line.replace(CODE_SPAN, "").includes("<!--"))
        report(number, "Remove handwritten comments and put lasting instructions under Rules.");
    if (agents) checkAgents(lines, report);
    else checkReadme(lines, report);
  }
  return findings;
}
