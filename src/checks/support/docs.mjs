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
 * Code a doc names things in: each code span, and each code block from its first line, with `span` false and its fence's language.
 * @typedef {{ line: number, text: string, span: boolean, lang: string | null }} Code
 * `lines` counts newlines, as `wc -l` does.
 * @typedef {{ path: string, kind: Kind, lines: number, links: Link[], code: Code[], anchors: ReadonlySet<string>, marker: boolean }} Doc
 * @typedef {{ docs: ReadonlyMap<string, Doc>, misplaced: { path: string, refused: boolean }[] }} Corpus
 */

const IMPORT = /^@(\S+)\s*$/;
const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const MARKER = "<!-- check-docs: external -->";

/** @type {(text: string) => import("mdast").Root} The tree GitHub renders a doc from, with YAML front matter as one node. */
export const markdownTree = (text) => fromMarkdown(text, { extensions: [gfm(), frontmatter()], mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown()] });

/** @type {(node: Node) => number} */
const lineOf = (node) => node.position?.start.line ?? 0;

/** @type {(node: Node, visit: (node: Node) => void) => void} Visits each node in document order. */
function walk(node, visit) {
  visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit);
}

/** @type {(node: Node) => string} The text a node renders, without its HTML. */
const rendered = (node) => (node.type === "text" || node.type === "inlineCode" ? node.value : "children" in node ? node.children.map(rendered).join("") : "");

/** @type {(tree: import("mdast").Root) => ReadonlySet<string>} The anchor GitHub gives each heading, with the next free `-1`, `-2` after a repeat. */
export function headingAnchors(tree) {
  /** @type {Set<string>} */
  const anchors = new Set();
  /** @type {Map<string, number>} */
  const repeats = new Map();
  walk(tree, (node) => {
    if (node.type !== "heading") return;
    const base = rendered(node).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/gu, "-");
    let anchor = base;
    while (anchors.has(anchor)) {
      const repeat = (repeats.get(base) ?? 0) + 1;
      repeats.set(base, repeat);
      anchor = `${base}-${repeat}`;
    }
    anchors.add(anchor);
  });
  return anchors;
}

/** @type {(part: string) => string} */
function decode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * @param {string} from The doc the link is in.
 * @param {string} url
 * @returns {{ path: string, anchor: string | null } | null} Null for a URL.
 */
function land(from, url) {
  if (SCHEME.test(url)) return null;
  const [file = "", anchor] = url.split("#", 2);
  const decoded = decode(file.split("?")[0] ?? "");
  const path = decoded === "" ? from : decoded.startsWith("/") ? posix.normalize(decoded.slice(1)) : posix.join(posix.dirname(from), decoded);
  return { path: path.replace(/\/$/, ""), anchor: anchor === undefined ? null : decode(anchor) };
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
  /** @type {Code[]} */
  const code = [];
  let marker = false;
  const add = (/** @type {number} */ line, /** @type {string} */ written, /** @type {string} */ url) => {
    const landed = land(path, url);
    if (landed) links.push({ line, text: written, ...landed });
  };
  const link = (/** @type {Node} */ node, /** @type {string} */ url) => add(lineOf(node), text.slice(node.position?.start.offset, node.position?.end.offset), url);
  const tree = markdownTree(text);
  walk(tree, (node) => {
    if (node.type === "link" || node.type === "image") link(node, node.url);
    else if (node.type === "linkReference" || node.type === "imageReference") used.add(node.identifier);
    else if (node.type === "definition") definitions.push(node);
    else if (node.type === "html") marker ||= node.value.includes(MARKER);
    else if (node.type === "inlineCode") code.push({ line: lineOf(node), text: node.value.replaceAll("\n", " "), span: true, lang: null });
    else if (node.type === "code") {
      const fenced = "`~".includes(text[node.position?.start.offset ?? 0] ?? "");
      code.push({ line: lineOf(node) + (fenced ? 1 : 0), text: node.value, span: false, lang: node.lang?.toLowerCase() ?? null });
    } else if (node.type === "text" && kind.name === "agents") {
      node.value.split("\n").forEach((part, at) => {
        const line = lineOf(node) + at;
        const imported = IMPORT.exec(part.trim());
        if (imported?.[1] && part.trim() === source[line - 1]?.trim()) add(line, imported[0], imported[1]);
      });
    }
  });
  for (const definition of definitions) if (used.has(definition.identifier)) link(definition, definition.url);
  return { path, kind, lines: source.length - 1, links, code, anchors: headingAnchors(tree), marker };
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
