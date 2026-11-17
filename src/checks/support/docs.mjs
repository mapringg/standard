import { posix } from "node:path";

import { isDoc, place } from "../../doc-kinds.mjs";
import { proseLines } from "./markdown.mjs";

/**
 * @typedef {import("../../doc-kinds.mjs").Kind} Kind
 *
 * A link as written on its line, and the repository path it lands on, which may not exist.
 * @typedef {{ line: number, text: string, path: string, anchor: string | null }} Link
 * @typedef {{ path: string, kind: Kind, links: Link[], marker: boolean }} Doc
 * @typedef {{ docs: ReadonlyMap<string, Doc>, misplaced: { path: string, refused: boolean }[] }} Corpus
 */

const INLINE = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/;
const IMPORT = /^@(\S+)\s*$/;
const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const MARKER = "<!-- check-docs: external -->";

/**
 * @param {string} from The doc the link is in.
 * @param {string} written
 * @returns {{ path: string, anchor: string | null } | null} Null for a URL.
 */
function land(from, written) {
  const target = written.replace(/^<|>$/g, "");
  if (SCHEME.test(target)) return null;
  const [file = "", anchor] = target.split("#", 2);
  let decoded = file.split("?")[0] ?? "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}
  const path = decoded === "" ? from : decoded.startsWith("/") ? posix.normalize(decoded.slice(1)) : posix.join(posix.dirname(from), decoded);
  return { path: path.replace(/\/$/, ""), anchor: anchor ?? null };
}

/**
 * @param {string} path
 * @param {Kind} kind
 * @param {string} text
 * @returns {Doc}
 */
export function parseDoc(path, kind, text) {
  /** @type {Link[]} */
  const links = [];
  proseLines(text).forEach((raw, index) => {
    if (raw === null) return;
    const line = raw.replace(/<!--.*?-->/g, "").replace(/`[^`]*`/g, "");
    const written = [...line.matchAll(INLINE)].map((match) => [match[0], match[1]]);
    const definition = DEFINITION.exec(line);
    if (definition) written.push([definition[0], definition[1]]);
    const imported = kind.name === "agents" ? IMPORT.exec(line) : null;
    if (imported) written.push([imported[0], imported[1]]);
    for (const [text = "", target = ""] of written) {
      const landed = land(path, target);
      if (landed) links.push({ line: index + 1, text, ...landed });
    }
  });
  return { path, kind, links, marker: text.includes(MARKER) };
}

/** @type {(repo: import("../../repo.mjs").Repo) => Corpus} Every governed doc parsed once. */
export function loadCorpus(repo) {
  /** @type {Map<string, Doc>} */
  const docs = new Map();
  /** @type {Corpus["misplaced"]} */
  const misplaced = [];
  for (const placement of repo.files().filter(isDoc).map(place)) {
    if (placement.kind) docs.set(placement.path, parseDoc(placement.path, placement.kind, repo.read(placement.path)));
    else misplaced.push({ path: placement.path, refused: placement.refused });
  }
  return { docs, misplaced };
}
