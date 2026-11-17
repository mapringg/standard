import { posix } from "node:path";

/**
 * @typedef {"verify" | "skills" | "agents" | "external" | "conventions" | "readme" | "template"} KindName
 *
 * One kind of doc, by path only. The first kind whose `files` match a path owns it.
 * @typedef {object} Kind
 * @property {KindName} name
 * @property {readonly string[]} files
 * @property {readonly string[]} roots The docs agent tooling loads by itself. Links reach every other doc from them.
 * @property {boolean} exempt Other tooling shows it, so it needs no link, and its links reach nothing.
 * @property {"all" | "local" | "none"} references What the reference rule checks. "local" checks links and the paths under a tracked top-level entry, since the rest name an outside system.
 *
 * @typedef {{ path: string, kind: Kind } | { path: string, kind: null, refused: boolean }} Placement
 */

const SKILL = [".claude/skills/*/SKILL.md"];
const AGENTS = ["**/AGENTS.md", "**/CLAUDE.md", ".gemini/styleguide.md"];

/** @type {readonly Kind[]} In match order: verify before skills, external before conventions. */
export const KINDS = [
  { name: "verify", files: [".claude/skills/verify-*/**/*.md"], roots: SKILL, exempt: false, references: "all" },
  { name: "skills", files: [".claude/skills/**/*.md"], roots: SKILL, exempt: false, references: "all" },
  { name: "agents", files: AGENTS, roots: AGENTS, exempt: false, references: "all" },
  { name: "external", files: ["docs/external/*.md", "apps/*/docs/external/*.md"], roots: [], exempt: false, references: "local" },
  { name: "conventions", files: ["docs/*.md", "apps/*/docs/*.md"], roots: [], exempt: false, references: "all" },
  { name: "readme", files: ["README.md", "apps/*/README.md", "packages/*/README.md"], roots: [], exempt: true, references: "all" },
  { name: "template", files: [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE/*.md"], roots: [], exempt: true, references: "none" },
];

const DOC = /\.mdx?$/i;
const REFUSED = /^(?:changelog[^/]*|todo|roadmap|notes|backlog|decision-log|[^/]*-(?:plan|progress|status|notes|changelog|backlog|roadmap))\.md$/i;

/** @type {(path: string) => boolean} Whether the docs checks govern the file, which every tracked Markdown file outside node_modules is. */
export const isDoc = (path) => DOC.test(path) && !path.split("/").includes("node_modules");

/** @type {(path: string, globs: readonly string[]) => boolean} */
export const matches = (path, globs) => globs.some((glob) => posix.matchesGlob(path, glob));

/** @type {(path: string) => Placement} */
export function place(path) {
  if (REFUSED.test(posix.basename(path))) return { path, kind: null, refused: true };
  const kind = KINDS.find((each) => matches(path, each.files));
  return kind ? { path, kind } : { path, kind: null, refused: false };
}
