import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix, relative } from "node:path";

import { parseSync } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";

import { FILE } from "./config.mjs";
import { git } from "./repo.mjs";
import { EFFECT, parseName, withSegment } from "./oxlint/roles.mjs";

/** The words in an effect wrapper's legacy reason that name one effect role. A reason that matches no role, or more than one, goes to a human. */
const WORDS = {
  sync: /\b(?:binds?|in step|imperative|instance|engine|zoom|frame|simulation|cancels?|aborts?)\b/i,
  route: /\b(?:pathname|search params|route|url|address|navigation)\b/i,
  subscribe: /\b(?:subscribes?|listeners?|listens?|beforeunload)\b/i,
};
const SOURCE = /\.[cm]?[jt]sx?$/;

/** @param {string} reason @returns {string | undefined} */
export function effectReason(reason) {
  const found = Object.entries(WORDS).filter(([, words]) => words.test(reason)).map(([name]) => name);
  return found.length === 1 ? found[0] : undefined;
}

const MOCKS = new Set(["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock"]);

/** @param {any} node @returns {{ value: string, start: number, end: number } | { computed: string } | undefined} The module a string or template names. */
function specifier(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return { value: node.value, start: node.start, end: node.end };
  if (node?.type !== "TemplateLiteral") return undefined;
  if (node.expressions.length === 0) return { value: node.quasis[0].value.cooked, start: node.start, end: node.end };
  return { computed: node.quasis.map((/** @type {any} */ quasi) => quasi.value.cooked).join("*") };
}

/**
 * Every import, export from, import(), require() and vi.mock-style call that reaches a renamed file, as an edit, or as a problem
 * when the specifier cannot follow the rename, such as an exact tsconfig alias or a computed import().
 * @param {string} root @param {readonly string[]} files @param {ReadonlyMap<string, string>} renames
 */
function importEdits(root, files, renames) {
  const resolver = new ResolverFactory({ tsconfig: "auto", conditionNames: ["import", "default"], extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"], extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] } });
  /** @type {Map<string, { start: number, end: number, text: string, from: string, to: string }[]>} */
  const edits = new Map();
  /** @type {string[]} */
  const problems = [];
  const stems = [...renames.keys()].map((from) => [from, posix.basename(from).split(".")[0]]);
  for (const file of files.filter((path) => SOURCE.test(path) && !path.endsWith(".d.ts") && !path.includes("node_modules/"))) {
    const absolute = join(root, file);
    if (!existsSync(absolute)) continue;
    const source = readFileSync(absolute, "utf8");
    const { program } = parseSync(file, source);
    /** @type {any[]} */
    const found = [];
    /** @param {any} node */
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      const callee = node.type === "CallExpression" ? node.callee : undefined;
      const mock = callee?.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "vi" && MOCKS.has(callee.property.name);
      const target = node.type === "ImportExpression" || node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration" ? node.source : callee?.type === "Identifier" && callee.name === "require" || mock ? node.arguments[0] : undefined;
      const named = specifier(target);
      if (named) found.push(named);
      for (const [key, value] of Object.entries(node)) if (key !== "parent") for (const item of Array.isArray(value) ? value : [value]) visit(item);
    };
    visit(program);
    for (const named of found) {
      if ("computed" in named) {
        const prefix = named.computed.split("*")[0];
        const folder = prefix.startsWith(".") ? posix.join(posix.dirname(file), prefix.slice(0, prefix.lastIndexOf("/") + 1)) : undefined;
        for (const [from, stem] of stems) if (named.computed.includes(stem) || folder && posix.dirname(from) === posix.normalize(folder).replace(/\/$/, "")) problems.push(`cannot rewrite ${file}: a computed import() may reach ${from}`);
        continue;
      }
      const { value, start, end } = named;
      const target = resolver.resolveFileSync(absolute, value).path;
      const at = target ? relative(root, target).split("\\").join("/") : "";
      const renamed = renames.get(at);
      if (!renamed) continue;
      const old = posix.basename(at);
      const stem = old.replace(/\.[^.]+$/, "");
      const last = value.split("/").at(-1) ?? "";
      if (last !== old && last !== stem && !last.startsWith(`${stem}.`)) {
        problems.push(`cannot rewrite ${file}: ${JSON.stringify(value)} reaches ${at}`);
        continue;
      }
      const next = last === old ? posix.basename(renamed) : posix.basename(renamed).replace(/\.[^.]+$/, "") + last.slice(stem.length);
      const quote = source[start];
      const to = `${value.slice(0, value.length - last.length)}${next}`;
      if (!edits.has(file)) edits.set(file, []);
      edits.get(file)?.push({ start, end, text: `${quote}${to}${quote}`, from: value, to });
    }
  }
  return { edits, problems: [...new Set(problems)] };
}

/** @param {string} source @param {string} test @returns {number} How many of the source's name segments the test's name starts with, or 0. */
function companion(source, test) {
  const parts = posix.basename(source).split(".").slice(0, -1);
  const tested = posix.basename(test).split(".");
  return parts.every((part, index) => tested[index] === part) ? parts.length : 0;
}

/**
 * Removes the entries of top-level lists that keep rejects, and a list it empties, and leaves every other byte of the JSON text as written.
 * @param {string} text @param {Record<string, (entry: any) => boolean>} keeps
 */
function dropEntries(text, keeps) {
  const { program } = parseSync("config.ts", `(${text})`);
  /** @type {any} */
  let root = /** @type {any} */ (program.body[0]).expression;
  while (root.type === "ParenthesizedExpression") root = root.expression;
  const props = root.properties;
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {Set<number>} */
  const removed = new Set();
  props.forEach((/** @type {any} */ prop, /** @type {number} */ index) => {
    const keep = keeps[prop.key.value];
    if (!keep || prop.value.type !== "ArrayExpression") return;
    const items = prop.value.elements;
    const kept = items.filter((/** @type {any} */ item) => keep(JSON.parse(text.slice(item.start - 1, item.end - 1))));
    if (kept.length === items.length) return;
    if (kept.length === 0) { removed.add(index); return; }
    const separator = items.length > 1 ? text.slice(items[0].end - 1, items[1].start - 1) : ", ";
    edits.push({ start: items[0].start - 1, end: items.at(-1).end - 1, text: kept.map((/** @type {any} */ item) => text.slice(item.start - 1, item.end - 1)).join(separator) });
  });
  const stay = props.flatMap((/** @type {any} */ prop, /** @type {number} */ index) => removed.has(index) ? [] : [prop]);
  /** @type {[number, number][]} */
  const cuts = [...removed].map((index) => {
    const prop = props[index];
    const next = stay.find((/** @type {any} */ item) => item.start > prop.start);
    const previous = stay.findLast((/** @type {any} */ item) => item.end < prop.start);
    return next ? [prop.start, next.start] : previous ? [previous.end, prop.end] : [prop.start, prop.end];
  });
  for (const [start, end] of cuts.toSorted((a, b) => a[0] - b[0]).reduce((/** @type {[number, number][]} */ merged, cut) => {
    const last = merged.at(-1);
    if (last && cut[0] <= last[1]) last[1] = Math.max(last[1], cut[1]);
    else merged.push([...cut]);
    return merged;
  }, [])) edits.push({ start: start - 1, end: end - 1, text: "" });
  return edits.toSorted((a, b) => b.start - a.start).reduce((current, { start, end, text: replacement }) => current.slice(0, start) + replacement + current.slice(end), text);
}

/**
 * Moves each file the legacy `effect-wrappers` and `client-data` lists name into a name that carries its role, and rewrites the imports
 * that reach it. Without write it only prints the plan.
 * @param {string} root @param {{ write: boolean, picks: ReadonlyMap<string, string> }} options @returns {{ ok: boolean, lines: string[] }}
 */
export function migrateNames(root, { write, picks }) {
  const path = join(root, FILE);
  const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  /** @type {{ file: string, reason: string }[]} */
  const wrappers = config["effect-wrappers"] ?? [];
  /** @type {{ file?: string, app?: string, reason: string }[]} */
  const data = config["client-data"] ?? [];
  /** @type {Map<string, string[]>} */
  const segments = new Map();
  const add = (/** @type {string} */ file, /** @type {string} */ segment) => segments.set(file, [...segments.get(file) ?? [], segment]);
  const lines = [];
  const pending = new Set();
  for (const { file, reason } of wrappers) {
    const role = picks.get(file) ?? effectReason(reason);
    if (role) add(file, `effect-${role}`);
    else {
      pending.add(file);
      lines.push(`pick ${file}: ${JSON.stringify(reason)} Rerun with --effect ${file}=<${EFFECT.join("|")}>, or rewrite the effect.`);
    }
  }
  for (const entry of data) if (entry.file) add(entry.file, `data-${entry.reason}`);
  const tracked = git(root, "ls-files", "-z").split("\0").filter(Boolean);
  const trackedSet = new Set(tracked);
  /** @type {Map<string, string>} */
  const renames = new Map();
  for (const [file, roles] of segments) {
    if (posix.basename(file).split(".")[0] === "index") {
      pending.add(file);
      lines.push(`pick ${file}: an index file keeps its name. Move the code into a named module that carries ${roles.join(".")}, then rerun.`);
      continue;
    }
    const name = parseName(file);
    const missing = roles.filter((segment) => !(segment.startsWith("data-") ? name.data : name.effect).includes(segment.split("-").slice(1).join("-")));
    const sorted = [...missing.filter((segment) => segment.startsWith("data-")), ...missing.filter((segment) => segment.startsWith("effect-"))];
    const next = sorted.reduce((current, segment) => withSegment(current, segment), file);
    if (next !== file && existsSync(join(root, file))) renames.set(file, next);
  }
  const TEST = /\.(?:test|spec|stories)\./;
  for (const test of tracked.filter((path) => TEST.test(path))) {
    const siblings = tracked.filter((path) => posix.dirname(path) === posix.dirname(test) && !TEST.test(path) && SOURCE.test(path));
    const best = siblings.toSorted((a, b) => companion(b, test) - companion(a, test))[0];
    const to = best && companion(best, test) > 0 ? renames.get(best) : undefined;
    if (!best || !to) continue;
    const kept = posix.basename(best).split(".").slice(0, -1).length;
    renames.set(test, posix.join(posix.dirname(test), [...posix.basename(to).split(".").slice(0, -1), ...posix.basename(test).split(".").slice(kept)].join(".")));
  }
  const destinations = [...renames.values()];
  const conflicts = [...renames].flatMap(([from, to]) => [
    ...(trackedSet.has(from) ? [] : [`conflict ${from}: git does not track it`]),
    ...(existsSync(join(root, to)) || trackedSet.has(to) || destinations.indexOf(to) !== destinations.lastIndexOf(to) ? [`conflict ${from} -> ${to}: the destination exists`] : []),
  ]);
  lines.unshift(...[...renames].map(([from, to]) => `rename ${from} -> ${to}`));
  const files = [...tracked, ...git(root, "ls-files", "-z", "--others", "--exclude-standard").split("\0").filter(Boolean)];
  const { edits, problems } = importEdits(root, files, renames);
  const count = [...edits.values()].reduce((total, list) => total + list.length, 0);
  if (conflicts.length || problems.length) return { ok: false, lines: [...lines, ...conflicts, ...problems, `Refused: ${conflicts.length + problems.length} problems. Fix them and rerun; nothing was changed.`] };
  if (!write) return { ok: true, lines: [...lines, `Dry run: ${renames.size} renames, ${count} imports in ${edits.size} files. Run with --write to apply.`] };
  for (const [file, list] of edits) {
    let text = readFileSync(join(root, file), "utf8");
    for (const { start, end, text: replacement } of list.toSorted((a, b) => b.start - a.start)) text = text.slice(0, start) + replacement + text.slice(end);
    writeFileSync(join(root, file), text);
  }
  for (const [from, to] of renames) git(root, "mv", from, to);
  const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const movePaths = (/** @type {string} */ text) => [...renames].reduce((current, [from, to]) => current.replace(new RegExp(`${escape(from)}(?![\\w.-])`, "g"), to), text);
  /** @type {[string, string][]} Each tail of a renamed path, longest first, that ends no other tracked file, with its new tail. */
  const tails = [...renames].flatMap(([from, to]) => {
    const parts = from.split("/");
    const moved = posix.basename(to);
    return parts.map((_, index) => parts.slice(index).join("/")).filter((tail) => tracked.filter((file) => file === tail || file.endsWith(`/${tail}`)).length === 1).map((tail) => /** @type {[string, string]} */ ([tail, `${tail.slice(0, tail.length - posix.basename(from).length)}${moved}`]));
  }).toSorted((a, b) => b[0].length - a[0].length);
  for (const doc of tracked.filter((file) => file.endsWith(".md"))) {
    const before = readFileSync(join(root, doc), "utf8");
    const after = tails.reduce((current, [from, to]) => current.replace(new RegExp(`(?<![\\w.@/-])${escape(from)}(?![\\w.-])`, "g"), to), movePaths(before));
    if (after !== before) writeFileSync(join(root, doc), after);
  }
  for (const baseline of tracked.filter((file) => file.startsWith(".standard/baselines/") && file.endsWith(".json"))) {
    const before = readFileSync(join(root, baseline), "utf8");
    let after = before;
    for (const [file, list] of edits) for (const { from, to } of list) after = after.replace(new RegExp(`("${escape(file)}\\s[^"]*?)${escape(from)}(?=["\\s:])`, "g"), `$1${to}`);
    after = movePaths(after);
    if (after !== before) writeFileSync(join(root, baseline), after);
  }
  const original = new Map([...renames].map(([from, to]) => [to, from]));
  const keep = (/** @type {string} */ moved) => { const file = original.get(moved) ?? moved; return pending.has(file) || !segments.has(file); };
  if (existsSync(path)) {
    const before = readFileSync(path, "utf8");
    const after = dropEntries(movePaths(before), { "effect-wrappers": (/** @type {{ file: string }} */ entry) => keep(entry.file), "client-data": (/** @type {{ app?: string }} */ entry) => Boolean(entry.app) });
    if (after !== before) writeFileSync(path, after);
  }
  return { ok: true, lines: [...lines.filter((line) => line.startsWith("pick ")), `Renamed ${renames.size} files and rewrote ${count} imports in ${edits.size} files. ${pending.size} effect wrapper${pending.size === 1 ? " needs" : "s need"} a reason.`] };
}
