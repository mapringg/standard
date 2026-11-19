import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { anchorFor, listFiles, locate } from "./paths.mjs";

const SECTIONS = ["Rules", "Words", "Copy", "Decisions", "Traps", "Operations", "Sources"];
const MAX_LINES = 50;
const CODE = /\.[cm]?[jt]sx?$/;
const GENERATED = /<!-- BEGIN:([\w-]+) -->[\s\S]*?<!-- END:\1 -->/g;
const FENCE = /^```[\s\S]*?^```/gm;
const SPAN = /`([^`\n]+)`/g;
const LINK = /\]\(([^)\s]+)\)/g;
const PATH_START = /^(?:\.{1,2}\/)*(?:src|apps|packages|lib|scripts|infra|test|e2e|components|features)\//;
const PATH_END = /\/[^/\s]*\.(?:[cm]?[jt]sx?|json|ya?ml|toml|css|astro|sh|py)$/;
const VERSION = /(?<![\d.])v?\d+\.\d+\.\d+(?!\.?\d)/g;
const CACHE_MS = 2000;
const scans = new Map();

function blank(text) {
  return text.replaceAll(/[^\n]/g, "");
}

function prose(text) {
  return text.replaceAll(GENERATED, blank).replaceAll(FENCE, blank);
}

function slug(heading) {
  return heading
    .replaceAll("`", "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N} _-]/gu, "")
    .replaceAll(" ", "-");
}

function headings(text) {
  return [...prose(text).matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map(([, marks, title]) => ({
    level: marks.length,
    title,
  }));
}

function isPath(token) {
  return !token.endsWith(".md") && !token.includes("://") && (PATH_START.test(token) || PATH_END.test(token));
}

function shapeProblems(text) {
  const found = [];
  const body = prose(text);
  const lines = body.trimEnd().split("\n");
  const titles = headings(text);
  if (!/^# \S/.test(lines[0] ?? "")) found.push("Start with one # title naming the app or repo.");
  if (titles.filter((item) => item.level === 1).length > 1)
    found.push("Keep one # title; make the others ## sections.");
  if (titles.some((item) => item.level > 2)) found.push("Use only ## sections; fold deeper headings into bullets.");
  const sections = titles.filter((item) => item.level === 2).map((item) => item.title);
  const unknown = sections.filter((title) => !SECTIONS.includes(title));
  if (unknown.length > 0) found.push(`Rename the section ${unknown.join(", ")} to one of ${SECTIONS.join(", ")}.`);
  const order = sections.filter((title) => SECTIONS.includes(title)).map((title) => SECTIONS.indexOf(title));
  if (order.some((index, at) => at > 0 && index <= order[at - 1]))
    found.push(`Put each section once, in the order ${SECTIONS.join(", ")}.`);
  if (lines.length > MAX_LINES)
    found.push(`Cut it to ${MAX_LINES} lines; keep only what the code and lint cannot tell an agent.`);
  return found;
}

function contentProblems(text) {
  const found = [];
  const body = prose(text);
  const tokens = [...body.matchAll(SPAN)].map((match) => match[1]);
  const targets = [...body.matchAll(LINK)].map((match) => match[1].split("#")[0]);
  const paths = [...new Set([...tokens, ...targets].filter((token) => isPath(token)))];
  if (paths.length > 0)
    found.push(`Name what ${paths.join(", ")} is instead of where it lives; paths go stale when files move.`);
  const versions = [...new Set(body.match(VERSION) ?? [])];
  if (versions.length > 0) found.push(`Drop ${versions.join(", ")}; the lockfile and manifests already pin versions.`);
  return found;
}

function linkProblems(root, rel, text) {
  const found = [];
  for (const [, target] of prose(text).matchAll(LINK)) {
    if (/^[a-z][\w+.-]*:/i.test(target)) continue;
    const [path, anchor] = target.split("#");
    const file = path ? normalize(join(dirname(rel), path)) : rel;
    const absolute = join(root, file);
    if (!existsSync(absolute)) {
      found.push(`Fix the link to ${target}; ${file} does not exist.`);
      continue;
    }
    if (anchor === undefined || !file.endsWith(".md")) continue;
    const own = file === rel ? text : readFileSync(absolute, "utf8");
    if (!headings(own).some((item) => slug(item.title) === anchor))
      found.push(`Fix the link to ${target}; ${file} has no heading #${anchor}.`);
  }
  return found;
}

function scan(root) {
  const files = listFiles(root);
  const lintable = files.filter((rel) => CODE.test(rel));
  const findings = new Map();
  for (const rel of files.filter((file) => file.endsWith(".md"))) {
    const text = readFileSync(join(root, rel), "utf8");
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    const problems = [
      ...(name === "AGENTS.md" ? [...shapeProblems(text), ...contentProblems(text)] : []),
      ...linkProblems(root, rel, text),
    ];
    const anchor = anchorFor(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "", lintable);
    if (!anchor || problems.length === 0) continue;
    findings.set(anchor, [...(findings.get(anchor) ?? []), ...problems.map((message) => `${rel}: ${message}`)]);
  }
  return findings;
}

function findingsFor(root) {
  const cached = scans.get(root);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.findings;
  const findings = scan(root);
  scans.set(root, { time: Date.now(), findings });
  return findings;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "AGENTS.md files share one shape and hold only what the code cannot show; Markdown links resolve. Findings report on the nearest linted file.",
    },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where) return {};
    return {
      Program(node) {
        for (const message of findingsFor(where.root).get(where.rel) ?? []) context.report({ node, message });
      },
    };
  },
};
