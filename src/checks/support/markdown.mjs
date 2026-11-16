const HEADING = /^#{1,4}\s/;
const FENCE = /^\s*(```|~~~)/;
const UNRENDERED_COMMENT = /<!--[\s\S]*?-->/g;
const IMAGE = /!\[[^\]]*\]\([^)]+\)|<img\b/i;

/**
 * @param {string} body
 * @returns {string}
 */
export function rendered(body) {
  return body.replace(UNRENDERED_COMMENT, "").trim();
}

/**
 * @param {string} body
 * @returns {string[]}
 */
export function evidenceLines(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{1,4}\s*Evidence\b/i.test(line));
  if (start === -1) return lines;

  let inFence = false;
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && HEADING.test(line)) break;
    section.push(line);
  }
  return section;
}

/**
 * @param {string} body
 * @returns {(string | null)[]} Each line, or null for a line inside a code fence.
 */
export function proseLines(body) {
  let inFence = false;
  return body.split("\n").map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return null;
    }
    return inFence ? null : line;
  });
}

/**
 * @param {string} body
 */
export function evidenceHasImage(body) {
  return IMAGE.test(evidenceLines(rendered(body)).join("\n"));
}
