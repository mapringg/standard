import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { anchorFor, listFiles, locate } from "./paths.mjs";

const SECTIONS = ["Rules", "Words", "Copy", "Decisions", "Traps", "Operations", "Sources"];
const MAX_LINES = 50;
const CODE = /\.[cm]?[jt]sx?$/;
const BEGIN = /^<!-- BEGIN:([\w-]+) -->\s*$/;
const FENCE_OPEN = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const SPAN = /(?<!`)(`+)(?!`)([\s\S]+?)(?<!`)\1(?!`)/g;
const INLINE_LINK =
  /!?\[(?:[^\]\n]|\][^(])*?\]\(\s*(<[^>\n]*>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
const REFERENCE = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm;
const DIRS =
  /^(?:\.{1,2}\/)*(?:\.github|\.claude|node_modules|dist|src|apps|packages|lib|scripts|infra|test|e2e|components|features)\//;
const EXTENSION = /\/[^/]*\.[a-z\d]+$/i;
const VERSION = /(?<![\d.])v?\d+\.\d+\.\d+(?!\.?\d)/g;
const CACHE_MS = 2000;
const scans = new Map();

function classify(text) {
  const lines = text.split("\n");
  const kinds = [];
  let fence = null;
  let generated = null;
  for (const line of lines) {
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
    if (begin) {
      generated = begin[1];
      kinds.push("generated");
      continue;
    }
    kinds.push("prose");
  }
  return lines.map((line, index) => ({ line, kind: kinds[index] }));
}

function joined(lines) {
  return lines.map((item) => item.line).join("\n");
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function destination(raw) {
  const bare = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  const hash = bare.indexOf("#");
  const path = (hash === -1 ? bare : bare.slice(0, hash)).split("?")[0];
  return { raw, path: decode(path), anchor: hash === -1 ? undefined : decode(bare.slice(hash + 1)) };
}

function links(lines) {
  const text = joined(lines).replaceAll(SPAN, "");
  return [...text.matchAll(REFERENCE), ...text.matchAll(INLINE_LINK)].map((match) => destination(match[1]));
}

function headingOf(line) {
  const match = HEADING.exec(line);
  if (!match) return null;
  const title = (match[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
  return { level: match[1].length, title };
}

function rendered(title) {
  return title
    .replaceAll(/\]\([^)]*\)/g, "]")
    .replaceAll(/\]\[[^\]]*\]/g, "]")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("`", "")
    .replaceAll(/(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1/g, "$2");
}

function slugs(lines) {
  const seen = new Map();
  const result = new Set();
  for (const { line, kind } of lines) {
    if (kind === "fence") continue;
    const heading = headingOf(line);
    if (!heading) continue;
    const base = rendered(heading.title)
      .trim()
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replaceAll(" ", "-");
    let count = seen.get(base) ?? 0;
    let slug = count === 0 ? base : `${base}-${count}`;
    while (result.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    seen.set(base, count + 1);
    result.add(slug);
  }
  return result;
}

function isPath(word) {
  const token = word.replace(/[.,;:)]+$/, "");
  if (token.startsWith("/") || token.includes("://") || token.endsWith(".md")) return false;
  return DIRS.test(token) || (token.includes("/") && EXTENSION.test(token));
}

function shapeProblems(prose) {
  const found = [];
  const lines = prose.map((item) => item.line);
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  const titles = lines.map((line) => headingOf(line)).filter(Boolean);
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

function contentProblems(prose) {
  const found = [];
  const spans = [...joined(prose).matchAll(SPAN)].flatMap((match) => match[2].split(/\s+/));
  const targets = links(prose).map((link) => link.path);
  const paths = [...new Set([...spans, ...targets].filter((token) => isPath(token)))];
  if (paths.length > 0)
    found.push(`Name what ${paths.join(", ")} is instead of where it lives; paths go stale when files move.`);
  const versions = [...new Set(prose.flatMap(({ line }) => line.match(VERSION) ?? []))];
  if (versions.length > 0) found.push(`Drop ${versions.join(", ")}; the lockfile and manifests already pin versions.`);
  return found;
}

function linkProblems(root, rel, prose, documentOf) {
  const found = [];
  for (const { raw, path, anchor } of links(prose)) {
    if (/^[a-z][\w+.-]*:/i.test(path) || (path === "" && anchor === undefined)) continue;
    const file = path ? normalize(join(dirname(rel), path)) : rel;
    if (!existsSync(join(root, file))) {
      found.push(`Fix the link to ${raw}; ${file} does not exist.`);
      continue;
    }
    if (anchor === undefined || anchor === "" || !file.endsWith(".md")) continue;
    if (!documentOf(file).slugs.has(anchor)) found.push(`Fix the link to ${raw}; ${file} has no heading #${anchor}.`);
  }
  return found;
}

function scan(root) {
  const files = listFiles(root);
  const lintable = files.filter((rel) => CODE.test(rel));
  const documents = new Map();
  const documentOf = (rel) => {
    if (!documents.has(rel)) {
      const lines = classify(readFileSync(join(root, rel), "utf8"));
      documents.set(rel, { prose: lines.filter((item) => item.kind === "prose"), slugs: slugs(lines) });
    }
    return documents.get(rel);
  };
  const findings = new Map();
  for (const rel of files.filter((file) => file.endsWith(".md"))) {
    const { prose } = documentOf(rel);
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    const problems = [
      ...(name === "AGENTS.md" ? [...shapeProblems(prose), ...contentProblems(prose)] : []),
      ...linkProblems(root, rel, prose, documentOf),
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
