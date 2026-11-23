const SECTIONS = ["Summary", "Evidence", "Merge Danger"];
const TICKET = /^Ticket: \S+$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const IMAGE = /!\[[^\]]*\]\([^)]+\)|<img\b/i;
const MEDIA =
  /!\[[^\]]*\]\([^)]+\)|<(?:img|video)\b|https:\/\/github\.com\/user-attachments\/assets\/|\.(?:png|jpe?g|gif|webp|mp4|mov|webm)\b/i;
const UI = /\.(?:tsx|jsx|astro|vue|svelte|css|scss)$/;
const TEST = /\.(?:test|spec|stories)\.[^.]+$/;
const DOOR = /^\**Door:\**\s*\**(one-way|two-way)\b/im;
const BLAST = /^\**Blast Radius:\**\s*\**([^\s*]+)\**\s*$/im;

function split(lines) {
  const sections = new Map();
  let fenced = false;
  let current = null;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const match = fenced ? null : HEADING.exec(line);
    if (match?.[1] === "##") {
      current = match[2];
      sections.set(current, [...(sections.get(current) ?? []), []]);
    } else if (current) sections.get(current).at(-1).push(line);
  }
  return {
    titles: [...sections.keys()],
    counts: sections,
    text: (title) => sections.get(title)?.[0]?.join("\n") ?? "",
  };
}

function templateProblems(lines) {
  const found = [];
  const { titles, counts, text } = split(lines);
  const start = TICKET.test(lines[0]) ? 1 : 0;
  const opening = lines.slice(start).find((line) => line.trim() !== "");
  if (opening?.trim() !== "## Summary")
    found.push("Body: start with ## Summary (after an optional Ticket: line); skip preambles.");
  const shape = SECTIONS.every((title, at) => titles[at] === title) && titles.length === SECTIONS.length;
  if (!shape || [...counts.values()].some((list) => list.length > 1))
    found.push(
      `Body: use the template's sections once each, in order: ## ${SECTIONS.join(", ## ")}. Got ${titles.length > 0 ? `## ${titles.join(", ## ")}` : "none"}.`,
    );
  const summary = text("Summary");
  if (counts.has("Summary") && !summary.split("\n").some((line) => FENCE.test(line)) && !IMAGE.test(summary))
    found.push(
      "Summary: add one visual, such as pseudocode, a call tree, a component tree, a file tree, a Mermaid diagram or a diff block.",
    );
  const evidence = text("Evidence").replaceAll("*", "");
  if (counts.has("Evidence") && !(/\bBefore:/.test(evidence) && /\bAfter:/.test(evidence)))
    found.push("Evidence: show a Before: and an After: (screenshot, output or test).");
  const danger = text("Merge Danger");
  if (counts.has("Merge Danger") && !DOOR.test(danger))
    found.push("Merge Danger: add a line **Door:** one-way or **Door:** two-way.");
  if (counts.has("Merge Danger") && !BLAST.test(danger))
    found.push("Merge Danger: add a line **Blast Radius:** <one word>, naming who or what the change can hurt.");
  return { found, evidence: text("Evidence") };
}

export function check(pull) {
  if (pull.bot) return [];
  const body = (pull.body ?? "").replaceAll("\r\n", "\n").trim();
  const { found, evidence } = templateProblems(body.split("\n"));
  const ui = pull.files.filter((file) => UI.test(file) && !TEST.test(file));
  if (ui.length > 0 && !MEDIA.test(evidence))
    found.push(`Evidence: ${ui[0]} is a user-visible change. Add screenshots or a recording.`);
  const shas = new Set(pull.commits);
  for (const other of pull.open) {
    if (
      other.number !== pull.number &&
      shas.has(other.sha) &&
      !new RegExp(`#${other.number}\\b|/pull/${other.number}\\b`).test(body)
    )
      found.push(`Body: this branch builds on unmerged #${other.number}. Name #${other.number} in the PR.`);
  }
  return found;
}
