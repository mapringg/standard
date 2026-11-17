import { parseSync } from "oxc-parser";

/** Every tracked file the source checks read. An Astro component counts through its frontmatter and scripts. */
const SOURCE = /\.(?:[cm]?[jt]sx?|astro)$/;
const ASTRO = /\.astro$/;

/** The script types a browser runs, from the HTML standard. Any other type, such as application/ld+json, is a data block. */
const SCRIPT_TYPES = new Set([
  "",
  "module",
  ...["ecmascript", "javascript", "x-ecmascript", "x-javascript"].map((name) => `application/${name}`),
  ...["ecmascript", "javascript", "javascript1.0", "javascript1.1", "javascript1.2", "javascript1.3", "javascript1.4", "javascript1.5", "jscript", "livescript", "x-ecmascript", "x-javascript"].map((name) => `text/${name}`),
]);

const OPEN_FENCE = /^\s*---[^\S\n]*\n/;
const CLOSE_FENCE = /^---/m;
const MARKUP = /<!--|<(script|style)(?=[\s/>])/gi;
const ATTRIBUTE_NAME = /[^\s"'>/={]+/y;
const UNQUOTED = /[^\s>]+/y;
const TOP_LEVEL_RETURN = "A 'return' statement can only be used within a function body";

/**
 * A span of the original text that holds code.
 * @typedef {{ start: number, end: number }} Region
 */

/** @param {Pick<import("../../repo.mjs").Repo, "files">} repo */
export function sourceFiles(repo) {
  return repo.files().filter((path) => SOURCE.test(path) && !path.split("/").includes("node_modules"));
}

/**
 * Parses a source as its extension says. An Astro component parses as TypeScript, each region on its own over the
 * component's text with every other character blanked, so offsets and lines are the original's. Its frontmatter may
 * return, as Astro allows.
 * @param {string} path
 * @param {string} text
 * @param {import("oxc-parser").ParserOptions} [options]
 * @returns {Pick<ReturnType<typeof parseSync>, "program" | "comments" | "errors"> & { text: string }} `text` is what was parsed.
 */
export function parseSource(path, text, options = {}) {
  if (!ASTRO.test(path)) {
    const { program, comments, errors } = parseSync(path, text, options);
    return { program, comments, errors, text };
  }
  const { frontmatter, scripts } = astroRegions(text);
  const regions = frontmatter ? [frontmatter, ...scripts] : scripts;
  const parsed = regions.map((region) => {
    const { program, comments, errors } = parseSync(path, blank(text, [region]), { ...options, lang: "ts", sourceType: "module" });
    return { program, comments, errors: region === frontmatter ? errors.filter((error) => !error.message.startsWith(TOP_LEVEL_RETURN)) : errors };
  });
  const program = { type: "Program", start: 0, end: text.length, sourceType: "module", hashbang: null, body: parsed.flatMap((result) => result.program.body) };
  return {
    program: /** @type {any} */ (program),
    comments: parsed.flatMap((result) => result.comments),
    errors: parsed.flatMap((result) => result.errors),
    text: blank(text, regions),
  };
}

/** @type {(text: string, regions: readonly Region[]) => string} The text with each character outside the regions a space, newlines kept. */
function blank(text, regions) {
  let code = "";
  let at = 0;
  for (const { start, end } of regions) {
    code += text.slice(at, start).replace(/[^\n]/g, " ") + text.slice(start, end);
    at = end;
  }
  return code + text.slice(at).replace(/[^\n]/g, " ");
}

/**
 * @param {string} text
 * @returns {{ frontmatter: Region | null, scripts: Region[] }} The `---` fenced block at the start, and the body of each
 * script a browser runs, is:inline ones included. Markup, HTML comments, styles and data scripts are not code.
 */
function astroRegions(text) {
  /** @type {Region | null} */
  let frontmatter = null;
  let at = 0;
  const open = OPEN_FENCE.exec(text);
  const close = open && CLOSE_FENCE.exec(text.slice(open[0].length));
  if (open && close) {
    frontmatter = { start: open[0].length, end: open[0].length + close.index };
    at = frontmatter.end + 3;
  }
  /** @type {Region[]} */
  const scripts = [];
  MARKUP.lastIndex = at;
  for (let match = MARKUP.exec(text); match; match = MARKUP.exec(text)) {
    if (match[0] === "<!--") {
      const end = text.indexOf("-->", match.index + 4);
      MARKUP.lastIndex = end === -1 ? text.length : end + 3;
      continue;
    }
    const element = /** @type {string} */ (match[1]).toLowerCase();
    const tag = openTag(text, match.index + match[0].length);
    if (tag.selfClosing) {
      MARKUP.lastIndex = tag.end;
      continue;
    }
    const closing = new RegExp(`</${element}(?=[\\s>])`, "gi");
    closing.lastIndex = tag.end;
    const end = closing.exec(text)?.index ?? text.length;
    const type = tag.attributes.get("type");
    if (element === "script" && (type === undefined || (type !== null && SCRIPT_TYPES.has(type.trim().toLowerCase())))) scripts.push({ start: tag.end, end });
    MARKUP.lastIndex = end;
  }
  return { frontmatter, scripts };
}

/**
 * @param {string} text
 * @param {number} from The offset just after the tag name.
 * @returns {{ end: number, selfClosing: boolean, attributes: Map<string, string | null> }} Where the tag ends, and each attribute's value, which is null for an expression.
 */
function openTag(text, from) {
  /** @type {Map<string, string | null>} */
  const attributes = new Map();
  let at = from;
  while (at < text.length) {
    const char = text[at];
    if (char === ">") return { end: at + 1, selfClosing: false, attributes };
    if (text.startsWith("/>", at)) return { end: at + 2, selfClosing: true, attributes };
    if (char === "{") {
      at = expressionEnd(text, at);
      continue;
    }
    ATTRIBUTE_NAME.lastIndex = at;
    const name = ATTRIBUTE_NAME.exec(text)?.[0];
    if (name === undefined) {
      at++;
      continue;
    }
    at += name.length;
    while (/\s/.test(text[at] ?? "")) at++;
    if (text[at] !== "=") {
      attributes.set(name.toLowerCase(), "");
      continue;
    }
    at++;
    while (/\s/.test(text[at] ?? "")) at++;
    const quote = text[at];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, at + 1);
      const end = close === -1 ? text.length : close;
      attributes.set(name.toLowerCase(), text.slice(at + 1, end));
      at = end + 1;
    } else if (quote === "{" || quote === "`") {
      attributes.set(name.toLowerCase(), null);
      at = quote === "{" ? expressionEnd(text, at) : text.indexOf("`", at + 1) + 1 || text.length;
    } else {
      UNQUOTED.lastIndex = at;
      const value = UNQUOTED.exec(text)?.[0] ?? "";
      attributes.set(name.toLowerCase(), value);
      at += value.length;
    }
  }
  return { end: text.length, selfClosing: false, attributes };
}

/** @type {(text: string, from: number) => number} The offset after the brace that closes the one at `from`, skipping braces inside strings. */
function expressionEnd(text, from) {
  let depth = 0;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === '"' || char === "'" || char === "`") {
      const close = text.indexOf(char, at + 1);
      if (close === -1) return text.length;
      at = close;
    } else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return at + 1;
  }
  return text.length;
}
