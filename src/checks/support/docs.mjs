import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { posix } from "node:path";

import { isDoc, place } from "../../doc-kinds.mjs";

/**
 * @typedef {import("../../doc-kinds.mjs").Kind} Kind
 * @typedef {import("mdast").Nodes} Node
 *
 * A link as written, on the line it starts, and the repository path it lands on, which may not exist.
 * A reference link is its definition, once, however many references use it.
 * @typedef {{ line: number, text: string, path: string, anchor: string | null }} Link
 * @typedef {{ path: string, kind: Kind, links: Link[], marker: boolean }} Doc
 * @typedef {{ docs: ReadonlyMap<string, Doc>, misplaced: { path: string, refused: boolean }[] }} Corpus
 */

const IMPORT = /^@(\S+)\s*$/;
const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const MARKER = "<!-- check-docs: external -->";

/** @type {(text: string) => import("mdast").Root} The tree GitHub renders a doc from, with YAML front matter as one node. */
const markdownTree = (text) => fromMarkdown(text, { extensions: [gfm(), frontmatter()], mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown()] });

/** @type {(node: Node) => number} */
const lineOf = (node) => node.position?.start.line ?? 0;

/** @type {(node: Node, visit: (node: Node) => void) => void} Visits each node in document order. */
function walk(node, visit) {
  visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit);
}

/**
 * @param {string} from The doc the link is in.
 * @param {string} url
 * @returns {{ path: string, anchor: string | null } | null} Null for a URL.
 */
function land(from, url) {
  if (SCHEME.test(url)) return null;
  const [file = "", anchor] = url.split("#", 2);
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
  const source = text.split("\n");
  /** @type {Link[]} */
  const links = [];
  /** @type {Set<string>} */
  const used = new Set();
  /** @type {import("mdast").Definition[]} */
  const definitions = [];
  let marker = false;
  const add = (/** @type {number} */ line, /** @type {string} */ written, /** @type {string} */ url) => {
    const landed = land(path, url);
    if (landed) links.push({ line, text: written, ...landed });
  };
  const link = (/** @type {Node} */ node, /** @type {string} */ url) => add(lineOf(node), text.slice(node.position?.start.offset, node.position?.end.offset), url);
  walk(markdownTree(text), (node) => {
    if (node.type === "link" || node.type === "image") link(node, node.url);
    else if (node.type === "linkReference" || node.type === "imageReference") used.add(node.identifier);
    else if (node.type === "definition") definitions.push(node);
    else if (node.type === "html") marker ||= node.value.includes(MARKER);
    else if (node.type === "text" && kind.name === "agents") {
      node.value.split("\n").forEach((part, at) => {
        const line = lineOf(node) + at;
        const imported = IMPORT.exec(part.trim());
        if (imported?.[1] && part.trim() === source[line - 1]?.trim()) add(line, imported[0], imported[1]);
      });
    }
  });
  for (const definition of definitions) if (used.has(definition.identifier)) link(definition, definition.url);
  return { path, kind, links, marker };
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
