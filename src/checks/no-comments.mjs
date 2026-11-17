import { execFileSync } from "node:child_process";
import { posix } from "node:path";

import { parseSource, sourceFiles } from "./support/sources.mjs";

/**
 * @typedef {import("../registry.mjs").Finding} Finding
 * @typedef {{ type: string, start: number, end: number, [key: string]: any }} Node
 * @typedef {{ type: "Line" | "Block", value: string, start: number, end: number }} Comment
 *
 * What a kind needs to judge one comment: the comment's text without its markers, whether it is part of the file's
 * license header, the SAFETY comments a type assertion claims, and the doc headings.
 * @typedef {{ body: string, header: boolean, comment: Comment, claimed: ReadonlyMap<Comment, Comment[]>, docs: ReadonlyMap<string, () => ReadonlySet<string>> }} Context
 *
 * One kind of comment the check recognises. `judge` returns undefined when the comment is not of this kind, null when it
 * passes, and otherwise the fix. The check tries the kinds in order, and a comment of no kind gets the COMMENT fix.
 * @typedef {{ key: string, judge(context: Context): string | null | undefined }} Kind
 */

const DOCS = ["docs/*.md", "apps/*/docs/*.md"];
const GENERATED_NAMES = new Set(["next-env.d.ts"]);

/** The only license text a source may hold: one SPDX tag, or an `@license` tag, naming a license expression and nothing else. */
const LICENSE_TAG = /^(?:SPDX-License-Identifier:|@license)\s+[\w.+()-]+(?:\s+(?:AND|OR|WITH)\s+[\w.+()-]+)*$/;

const LINT_DISABLE = /^(?:eslint|oxlint)-disable(?:-next-line|-line)?(?=\s|$)/;
const LINT_ENABLE = /^(?:eslint|oxlint)-enable(?=\s|$)/;
const LINT_REASON = /\s-{2,}\s+\S/;
const TS_EXPECT_ERROR = /^@ts-expect-error(?=[\s:]|$)/;
const TS_EXPECT_ERROR_REASON = /^@ts-expect-error[\s:-]*[^\s:-]/;
const TS_SILENCE = /^@ts-(?:ignore|nocheck)\b/;
const SAFETY = /^SAFETY:/;
const SENTENCE_END = /[.?!][`)]*$/;
const POINTER = /^See:\s+(\S+)$/;
const NEXT_LINE = /^[ \t]*\r?\n[ \t]*$/;
const DIRECTIVE = /^(?:(?:eslint|oxlint)-(?:disable|enable)|@ts-)/;

/** Nodes that own the comment above them, or above the export that holds them, so a SAFETY comment there claims the assertions inside. */
const OWNERS = new Set(["ExpressionStatement", "PropertyDefinition", "ReturnStatement", "ThrowStatement", "VariableDeclaration"]);

const COMMENT = `Move the why into a name, a test name or a type, or delete the comment. For a decision an agent would otherwise undo, write it under a heading in ${DOCS.join(" or ")} and point at it alone on a line with // See: <path>.md#<heading>.`;

/** @type {(heading: string) => string} The anchor GitHub gives a heading. */
const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/gu, "-");

/** @type {Kind[]} */
const KINDS = [
  {
    key: "lint-directive",
    judge: ({ body }) => {
      if (LINT_ENABLE.test(body)) return null;
      if (!LINT_DISABLE.test(body)) return undefined;
      return LINT_REASON.test(body) ? null : "Add ` -- <reason>` after the rule names.";
    },
  },
  {
    key: "ts-directive",
    judge: ({ body }) => {
      if (TS_EXPECT_ERROR.test(body)) return TS_EXPECT_ERROR_REASON.test(body) ? null : "Say why the error is expected after @ts-expect-error.";
      return TS_SILENCE.test(body) ? "Fix the type error, or write @ts-expect-error with the reason on the line above it." : undefined;
    },
  },
  {
    key: "safety",
    judge: ({ body, comment, claimed }) => {
      const run = claimed.get(comment);
      if (run) return SENTENCE_END.test(bodyOf(/** @type {Comment} */ (run.at(-1)))) ? null : "Finish the SAFETY sentence that states the invariant, and end it with ., ? or !.";
      if (SAFETY.test(body)) return "Delete the SAFETY comment, or put it directly above the type assertion it justifies.";
      return [...claimed.values()].some((lines) => lines.includes(comment)) ? null : undefined;
    },
  },
  {
    key: "doc-pointer",
    judge: ({ body, docs }) => {
      const pointer = POINTER.exec(body);
      if (!pointer) return undefined;
      const [path = "", anchor] = (pointer[1] ?? "").split("#", 2);
      const headings = docs.get(path);
      if (!headings) return `Point at a tracked doc that matches ${DOCS.join(" or ")}, with a path from the repository root; ${path} is not one.`;
      return anchor === undefined || headings().has(anchor) ? null : `Point at a heading ${path} has, as GitHub slugs it, or drop the anchor; it has no #${anchor}.`;
    },
  },
  { key: "license", judge: ({ header }) => (header ? null : undefined) },
];

/** @type {(comment: Comment) => string} */
function bodyOf(comment) {
  return comment.type === "Block" ? comment.value.replace(/^\s*\*?/, "").trim() : comment.value.trim();
}

/**
 * @param {string} text
 * @param {Node} program
 * @param {readonly Comment[]} comments In source order.
 * @returns {Map<Comment, Comment[]>} Each SAFETY comment directly above a type assertion, or above a node between the
 * assertion and its owner, with the line comments on the lines right after it.
 */
function claimedSafety(text, program, comments) {
  /** @type {(node: Node) => Comment | undefined} The last comment before node with only space and comments between them. */
  const above = (node) => {
    const before = comments.filter((comment) => comment.end <= node.start);
    let index = before.length - 1;
    if (index < 0 || text.slice(before[index].end, node.start).trim() !== "") return undefined;
    while (index > 0 && text.slice(before[index - 1].end, before[index].start).trim() === "") index--;
    return before.slice(index).find((comment) => SAFETY.test(bodyOf(comment)));
  };
  /** @type {Map<Comment, Comment[]>} */
  const claimed = new Map();
  /** @type {(node: Node, chain: Node[]) => void} */
  const visit = (node, chain) => {
    const assertion = node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
    const constant = node.typeAnnotation?.type === "TSTypeReference" && node.typeAnnotation.typeName?.name === "const";
    if (assertion && !constant) {
      const candidates = [node];
      for (const ancestor of chain.toReversed()) {
        const last = /** @type {Node} */ (candidates.at(-1));
        if (ancestor.type === "Program" || (OWNERS.has(last.type) && !ancestor.type.startsWith("Export"))) break;
        candidates.push(ancestor);
      }
      const safety = candidates.map(above).find(Boolean);
      if (safety && !claimed.has(safety)) {
        const run = [safety];
        for (const next of comments.slice(comments.indexOf(safety) + 1)) {
          const previous = /** @type {Comment} */ (run.at(-1));
          if (next.type !== "Line" || next.end > node.start || DIRECTIVE.test(bodyOf(next)) || !NEXT_LINE.test(text.slice(previous.end, next.start))) break;
          run.push(next);
        }
        claimed.set(safety, run);
      }
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === "object" && typeof child.type === "string") visit(child, [...chain, node]);
      }
    }
  };
  visit(program, []);
  return claimed;
}

/**
 * @param {readonly Comment[]} header The comments above the code, in source order.
 * @returns {Comment[]} The run from the first comment whose every line is a license tag. Third-party code with a full
 * license notice is vendored, and `.gitattributes` marks it `linguist-vendored`.
 */
function licenseHeader(header) {
  let end = 0;
  for (const comment of header) {
    const lines = comment.value.split("\n").map((line) => line.replace(/^[\s*!]+|[\s*]+$/g, "")).filter((line) => line !== "");
    if (lines.length === 0 || !lines.every((line) => LICENSE_TAG.test(line))) break;
    end += 1;
  }
  return header.slice(0, end);
}

/**
 * @param {import("../repo.mjs").Repo} repo
 * @param {readonly string[]} paths
 * @returns {Set<string>} The paths that .gitattributes marks `linguist-generated` or `linguist-vendored`, as GitHub reads them.
 */
function generatedPaths(repo, paths) {
  const fields = execFileSync("git", ["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"], { cwd: repo.root, input: paths.join("\0"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0");
  const generated = new Set();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (fields[index + 2] === "set" || fields[index + 2] === "true") generated.add(fields[index]);
  }
  return generated;
}

/**
 * @param {import("../repo.mjs").Repo} repo
 * @returns {Map<string, () => ReadonlySet<string>>} Each tracked doc a pointer may name, with its heading anchors read on first use.
 */
function trackedDocs(repo) {
  return new Map(
    repo.files().filter((path) => DOCS.some((glob) => posix.matchesGlob(path, glob))).map((path) => {
      /** @type {ReadonlySet<string> | undefined} */
      let anchors;
      const read = () => (anchors ??= new Set(repo.read(path).split("\n").flatMap((line) => {
        const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
        return heading ? [slug(heading[1] ?? "")] : [];
      })));
      return [path, read];
    }),
  );
}

/**
 * @param {string} path
 * @param {string} source
 * @param {ReadonlyMap<string, () => ReadonlySet<string>>} docs
 * @returns {Finding[]} One per kind of problem in the file, with every line in the fix.
 */
function findings(path, source, docs) {
  const { program, comments, errors, text } = parseSource(path, source);
  if (errors.length > 0) return [{ key: `${path} parse`, fix: `${path} does not parse, so no-comments cannot read it: ${errors[0]?.message}. Fix the syntax.` }];
  const sorted = /** @type {Comment[]} */ (comments.filter((comment) => comment.start !== program.hashbang?.start)).sort((a, b) => a.start - b.start);
  const codeStart = /** @type {Node[]} */ (program.body)[0]?.start ?? text.length;
  const licensed = new Set(licenseHeader(sorted.filter((comment) => comment.start < codeStart)));
  const claimed = claimedSafety(text, program, sorted);
  /** @type {Map<string, { key: string, lines: Set<number>, fix: string }>} */
  const found = new Map();
  for (const comment of sorted) {
    const context = { body: bodyOf(comment), header: licensed.has(comment), comment, claimed, docs };
    let verdict = /** @type {string | null | undefined} */ (undefined);
    let key = "comment";
    for (const kind of KINDS) {
      verdict = kind.judge(context);
      if (verdict !== undefined) {
        key = kind.key;
        break;
      }
    }
    if (verdict === null) continue;
    const fix = verdict ?? COMMENT;
    const id = `${key} ${fix}`;
    if (!found.has(id)) found.set(id, { key, lines: new Set(), fix });
    found.get(id)?.lines.add(text.slice(0, comment.start).split("\n").length);
  }
  return [...found.values()].map(({ key, lines, fix }) => {
    const sortedLines = [...lines].sort((a, b) => a - b);
    return { key: `${path} ${key}`, fix: `${path} has ${sortedLines.length > 1 ? "comments" : "a comment"} on line${sortedLines.length > 1 ? "s" : ""} ${sortedLines.join(", ")}. ${fix}` };
  });
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "no-comments",
  since: "0.13.0",
  doc: {
    enforces: "Source holds no comments except reasoned directives, `SAFETY:` above a type assertion, `See:` pointers to a doc or one of its headings, and a leading `SPDX-License-Identifier` or `@license` tag that names a license expression alone. `next-env.d.ts` and files that `.gitattributes` marks `linguist-generated` or `linguist-vendored` are skipped.",
    fix: "Move the why into a name, test or type, or into a doc that a `See:` comment points at. For a generated file, mark its path `linguist-generated` in `.gitattributes`; for third-party code with a license notice, mark it `linguist-vendored`.",
    config: [],
  },
  subject: "tree",
  baseline: false,
  retired: ["packages/oxlint-plugin-*/rules/no-comments.ts", "packages/oxlint-plugin-*/rules/no-comments.test.ts"],
  applies: () => ({ on: true }),
  run(repo) {
    const docs = trackedDocs(repo);
    const paths = sourceFiles(repo).filter((path) => !GENERATED_NAMES.has(posix.basename(path)));
    const generated = generatedPaths(repo, paths);
    return paths.filter((path) => !generated.has(path)).flatMap((path) => findings(path, repo.read(path), docs));
  },
};
