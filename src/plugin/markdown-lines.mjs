const BEGIN = /^<!-- BEGIN:([\w-]+) -->\s*$/;
const FENCE_OPEN = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;

export function classify(text) {
  const lines = text.split(/\r?\n/);
  const kinds = [];
  let fence = null;
  let generated = null;
  for (const [index, line] of lines.entries()) {
    if (fence) {
      kinds.push("fence");
      if (new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = open[1] ?? open[2];
      kinds.push("fence");
      continue;
    }
    if (generated) {
      kinds.push("generated");
      if (line.trim() === `<!-- END:${generated} -->`) generated = null;
      continue;
    }
    const begin = BEGIN.exec(line.trim());
    if (begin && lines.slice(index + 1).some((next) => next.trim() === `<!-- END:${begin[1]} -->`)) {
      generated = begin[1];
      kinds.push("generated");
      continue;
    }
    kinds.push("prose");
  }
  return lines.map((line, index) => ({ line, kind: kinds[index] }));
}
