import { spawnSync } from "node:child_process";
import { lstatSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { forEachChild, parse } from "unbash";

import { isDoc } from "../../doc-kinds.mjs";

/**
 * @typedef {import("./docs.mjs").Doc} Doc
 * @typedef {import("./docs.mjs").Corpus} Corpus
 * @typedef {import("../../repo.mjs").Repo} Repo
 * @typedef {import("../../registry.mjs").Finding} Finding
 *
 * What the reference rule resolves against, built once per run from tracked files.
 * @typedef {object} RepoIndex
 * @property {readonly string[]} files
 * @property {ReadonlySet<string>} entries Every tracked path and folder.
 * @property {ReadonlySet<string>} tails Every entry and each suffix of it after a "/", so `src/x.ts` names `apps/api/src/x.ts`.
 * @property {ReadonlySet<string>} top The tracked top-level entries.
 * @property {ReadonlySet<string>} dependencies Names in the dependency fields of every tracked package.json.
 * @property {ReadonlyMap<string, ReadonlySet<string>>} scripts Each package folder, "." for the root, to its script names.
 * @property {ReadonlyMap<string, string>} packages Each package's name and folder basename to its folder.
 * @property {() => Source} source What tracked text says, read on first use.
 *
 * @typedef {{ words: ReadonlySet<string>, names: ReadonlySet<string>, extensions: ReadonlySet<string> }} Source Identifier-shaped words
 * and file names in tracked files other than docs, and the extensions of tracked text files, so an image name such as `logo-12.png`
 * is not read as a path and a file a script writes, such as `result.json`, is not missing.
 *
 * A name that resolves to nothing. A path miss lists the paths that pass when git ignores one, since those exist at runtime.
 * @typedef {{ line: number, shown: string, reason: string, ignorable: readonly string[] }} Miss
 *
 * A `pnpm` command at an offset in its code, shown as the lines it spans.
 * @typedef {{ name: string, filter: string | null, dir: string | null, recursive: boolean, at: number, shown: string }} PnpmCall
 */

const MAX_BYTES = 2_000_000;
const NOT_PATH = /[\s<>$|=;'"\\]/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SYMBOL = /^(?:[a-z][a-z0-9]*[A-Z]\w*|[A-Z][a-z0-9]+[A-Z]\w*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:\(\))?$/;
const VALUE_FLAGS = new Set(["--filter", "-F", "-C", "--dir"]);
const UNCLOSED = "a quote is not closed, so no shell can run it; fix the quoting";
const PNPM_COMMANDS = new Set(
  "add approve-builds audit bin cache config create dedupe deploy dlx env exec fetch help i import init install install-test it licenses link list ln ls outdated pack patch patch-commit patch-remove prune publish rb rebuild remove rm root run self-update server setup start store t test un uninstall unlink up update upgrade why".split(" "),
);

/** @type {(repo: Repo) => RepoIndex} */
function repoIndex(repo) {
  const files = repo.files();
  const entries = new Set(files);
  for (const file of files) {
    for (let dir = posix.dirname(file); dir !== "." && !entries.has(dir); dir = posix.dirname(dir)) entries.add(dir);
  }
  /** @type {Set<string>} */
  const tails = new Set();
  for (const entry of entries) {
    for (let at = 0; at !== -1; at = entry.indexOf("/", at) + 1 || -1) tails.add(entry.slice(at));
  }
  /** @type {Map<string, Set<string>>} */
  const scripts = new Map();
  /** @type {Map<string, string>} */
  const packages = new Map();
  /** @type {Set<string>} */
  const dependencies = new Set();
  for (const path of files.filter((file) => posix.basename(file) === "package.json" && !file.split("/").includes("node_modules"))) {
    let manifest;
    try {
      manifest = JSON.parse(repo.read(path));
    } catch {
      continue;
    }
    const folder = posix.dirname(path);
    scripts.set(folder, new Set(Object.keys(manifest?.scripts ?? {})));
    for (const name of [manifest?.name, folder === "." ? null : posix.basename(folder)]) if (typeof name === "string") packages.set(name, folder);
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(manifest?.[field] ?? {})) dependencies.add(name);
    }
  }
  /** @type {Source | undefined} */
  let source;
  const readSource = () => {
    const words = new Set();
    const names = new Set();
    const extensions = new Set(files.filter(isDoc).map((file) => posix.extname(file)));
    for (const path of files.filter((file) => !isDoc(file))) {
      try {
        if (statSync(join(repo.root, path)).size > MAX_BYTES) continue;
        const text = repo.read(path);
        if (text.includes("\0")) continue;
        extensions.add(posix.extname(posix.basename(path)));
        for (const word of text.match(/[A-Za-z_$][\w$]*/g) ?? []) words.add(word);
        for (const name of text.match(/(?<![\w./-])[\w-]+(?:\.[\w-]+)+/g) ?? []) names.add(name);
      } catch {}
    }
    return (source = { words, names, extensions });
  };
  return {
    files,
    entries,
    tails,
    top: new Set([...entries].filter((entry) => !entry.includes("/"))),
    dependencies,
    scripts,
    packages,
    source: () => source ?? readSource(),
  };
}

/** @type {(text: string, index: RepoIndex) => string | null} The path a backtick span names, or null when its shape is not a repository path. */
function pathOf(text, index) {
  const path = text.replace(/(?::\d+(?:[-:]\d+)*|#.*)$/, "");
  if (path === "" || NOT_PATH.test(path) || path.replace(/\{[^}]*\}/g, "").includes(",") || SCHEME.test(path) || /^[/~-]/.test(path)) return null;
  if (path.startsWith("./") || path.startsWith("../")) return path;
  const extension = posix.extname(path);
  const known = extension !== "" && index.source().extensions.has(extension);
  if (path.includes("/")) return known || index.top.has(path.split("/")[0] ?? "") ? path : null;
  return known && /^\w[\w.-]*$/.test(path) ? path : null;
}

/** @type {(path: string, doc: Doc, index: RepoIndex) => Omit<Miss, "line" | "shown"> | null} */
function pathMiss(path, doc, index) {
  const [first = "", second] = path.split("/");
  if (index.dependencies.has(first) || index.dependencies.has(`${first}/${second}`)) return null;
  const bare = path.replace(/\/$/, "");
  if (path.startsWith("./") || path.startsWith("../")) {
    const tried = [];
    for (let dir = posix.dirname(doc.path); ; dir = posix.dirname(dir)) {
      tried.push(posix.join(dir, bare));
      if (index.entries.has(tried.at(-1) ?? "")) return null;
      if (dir === ".") return { reason: `no tracked file at ${tried[0]} or from a folder above it`, ignorable: tried };
    }
  }
  if (/[*{]/.test(bare)) return index.files.some((file) => posix.matchesGlob(file, `**/${bare}`)) ? null : { reason: "no tracked file matches this glob", ignorable: [] };
  return index.tails.has(bare) || (!bare.includes("/") && index.source().names.has(bare)) ? null : { reason: "no tracked file ends with this path", ignorable: [path, posix.join(posix.dirname(doc.path), path)] };
}

/** @type {(text: string, from: number, to: number) => string} The source lines from one offset to another as one line, as the shell joins a line that ends in a backslash. */
function linesOf(text, from, to) {
  const end = text.indexOf("\n", to);
  return text.slice(text.lastIndexOf("\n", from - 1) + 1, end === -1 ? text.length : end).replace(/\\\n[ \t]*/g, "").trim();
}

/** @type {(text: string) => { calls: PnpmCall[], unclosed: number | null }} Each command a POSIX shell runs in code whose command word is `pnpm`, with the package flags that pick where its script lives, and the offset of a quote that never closes in code that runs `pnpm`. */
function pnpmCalls(text) {
  const script = parse(text);
  /** @type {PnpmCall[]} */
  const calls = [];
  let runs = false;
  /** @type {(node: import("unbash").SyntaxNode) => void} */
  const visit = (node) => {
    if (node.type === "Command" && node.name?.value === "pnpm") {
      runs = true;
      const words = node.args.map((arg) => (arg.type === "Word" ? arg.value : ""));
      /** @type {PnpmCall} */
      const call = { name: "", filter: null, dir: null, recursive: false, at: node.pos, shown: linesOf(text, node.pos, node.end) };
      let next = 0;
      for (; words[next]?.startsWith("-"); next++) {
        const [flag = "", value] = (words[next] ?? "").split("=", 2);
        if (VALUE_FLAGS.has(flag)) call[flag === "-C" || flag === "--dir" ? "dir" : "filter"] = value ?? words[++next] ?? "";
        call.recursive ||= flag === "-r" || flag === "--recursive";
      }
      if (words[next] === "run") next++;
      call.name = words[next] ?? "";
      if (/^[\w:.@/][\w:.@/-]*$/.test(call.name)) calls.push(call);
    }
    forEachChild(node, visit);
  };
  visit(script);
  const unclosed = script.errors?.find((error) => error.message.endsWith("quote"));
  return { calls, unclosed: runs && unclosed ? unclosed.pos : null };
}

/** @type {(call: PnpmCall, doc: Doc, index: RepoIndex) => string | null} A script with no package flag lives in the package nearest the doc or in the root. */
function scriptMiss(call, doc, index) {
  if (PNPM_COMMANDS.has(call.name)) return null;
  const has = (/** @type {string} */ folder) => index.scripts.get(folder)?.has(call.name) ?? false;
  const named = call.dir ?? call.filter;
  if (call.recursive || (named !== null && /[*{]/.test(named))) return [...index.scripts.keys()].some(has) ? null : `no package.json has the script ${call.name}`;
  if (named === null) {
    let nearest = posix.dirname(doc.path);
    while (nearest !== "." && !index.scripts.has(nearest)) nearest = posix.dirname(nearest);
    const folders = [...new Set([nearest, "."])].filter((folder) => index.scripts.has(folder));
    if (folders.length === 0) return `no package.json has the script ${call.name}`;
    return folders.some(has) ? null : `${folders.map((folder) => posix.join(folder, "package.json")).join(" and ")} ${folders.length === 1 ? "has" : "have"} no script ${call.name}`;
  }
  const wanted = named.replace(/^\.{3}|\.{3}$/g, "");
  const folder = call.dir === null ? (index.packages.get(wanted) ?? posix.normalize(wanted)) : posix.normalize(wanted);
  if (!index.scripts.has(folder)) return `no package matches ${named}`;
  return has(folder) ? null : `${named} has no script ${call.name}`;
}

/** @type {(doc: Doc, corpus: Corpus, index: RepoIndex) => Miss[]} */
function misses(doc, corpus, index) {
  if (doc.kind.references === "none") return [];
  const local = doc.kind.references === "local";
  /** @type {Miss[]} */
  const found = [];
  for (const { line, text, span } of doc.code) {
    const { calls, unclosed } = pnpmCalls(text);
    const at = (/** @type {number} */ offset) => line + (text.slice(0, offset).match(/\n/g)?.length ?? 0);
    if (unclosed !== null) {
      if (!local) found.push({ line: at(unclosed), shown: `\`${linesOf(text, unclosed, unclosed)}\``, reason: UNCLOSED, ignorable: [] });
      continue;
    }
    if (calls.length > 0) {
      if (local) continue;
      for (const call of calls) {
        const reason = scriptMiss(call, doc, index);
        if (reason) found.push({ line: at(call.at), shown: `\`${call.shown}\``, reason, ignorable: [] });
      }
      continue;
    }
    if (!span) continue;
    const shown = `\`${text.trim()}\``;
    const path = pathOf(text, index);
    if (path !== null) {
      const miss = local && !index.top.has(path.split("/")[0] ?? "") ? null : pathMiss(path, doc, index);
      if (miss) found.push({ line, shown, ...miss });
    } else if (!local && SYMBOL.test(text) && !index.source().words.has(text.replace(/\(\)$/, ""))) {
      found.push({ line, shown, reason: "no tracked source has this word", ignorable: [] });
    }
  }
  for (const link of doc.links) {
    const target = corpus.docs.get(link.path);
    const reason = !index.entries.has(link.path) && link.path !== "."
      ? `${link.path} is not tracked`
      : target && link.anchor && !/^L\d/.test(link.anchor) && !target.anchors.has(link.anchor.toLowerCase())
        ? `${link.path} has no heading #${link.anchor}`
        : null;
    if (reason) found.push({ line: link.line, shown: link.text, reason, ignorable: [] });
  }
  return found.sort((a, b) => a.line - b.line);
}

/** @type {(root: string, path: string) => string} The path up to its first symlink, since git refuses to look beyond one. */
function beforeLink(root, path) {
  const parts = path.split("/");
  for (let at = 1; at < parts.length; at++) {
    const prefix = parts.slice(0, at).join("/");
    if (lstatSync(join(root, prefix), { throwIfNoEntry: false })?.isSymbolicLink()) return prefix;
  }
  return path;
}

/** @type {(repo: Repo, paths: readonly string[]) => ReadonlySet<string>} The paths git ignores, which exist only at runtime, such as `.env` or `logs/`. */
function ignored(repo, paths) {
  const checked = new Map([...new Set(paths)].filter((path) => !path.startsWith("../")).map((path) => [path, beforeLink(repo.root, path)]));
  if (checked.size === 0) return new Set();
  const { stdout } = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: repo.root, input: [...new Set(checked.values())].join("\n"), encoding: "utf8" });
  const hits = new Set((stdout ?? "").split("\n").filter(Boolean));
  return new Set([...checked].filter(([, path]) => hits.has(path)).map(([path]) => path));
}

/** @type {(repo: Repo, corpus: Corpus) => Finding[]} One finding per doc, with every name that resolves to nothing. */
export function referenceFindings(repo, corpus) {
  const index = repoIndex(repo);
  const found = [...corpus.docs.values()].map((doc) => /** @type {const} */ ([doc, misses(doc, corpus, index)]));
  const runtime = ignored(repo, found.flatMap(([, each]) => each.flatMap((miss) => miss.ignorable)));
  return found.flatMap(([doc, each]) => {
    const real = each.filter((miss) => !miss.ignorable.some((path) => runtime.has(path)));
    if (real.length === 0) return [];
    const list = real.map((miss) => `line ${miss.line} ${miss.shown} (${miss.reason})`).join(", ");
    const move = doc.kind.references === "local" ? "" : ", or move facts about an outside system to docs/external/";
    return [{ key: `${doc.path} reference`, fix: `${doc.path} names things that do not exist: ${list}. Fix each name${move}.` }];
  });
}
