import { parse as parseAstro } from "@astrojs/compiler/sync";
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

const TOP_LEVEL_RETURN = "A 'return' statement can only be used within a function body";

/**
 * A span of the original text that holds code.
 * @typedef {{ start: number, end: number }} Region
 *
 * Code laid over the component's blanked text at an offset: original text, or a stand-in of the same length, such as
 * `[` for an expression's `{`, so offsets and lines stay the original's.
 * @typedef {{ at: number, code: string }} Patch
 *
 * One piece of the component that parses as TypeScript on its own.
 * @typedef {{ patches: Patch[], lang: "ts" | "tsx", frontmatter: boolean }} Unit
 *
 * An HTML comment in the markup, which ships to every visitor. `start` is where its text starts.
 * @typedef {{ type: "Html", value: string, start: number, end: number }} HtmlComment
 */

/** @param {Pick<import("../../repo.mjs").Repo, "files">} repo */
export function sourceFiles(repo) {
  return repo.files().filter((path) => SOURCE.test(path) && !path.split("/").includes("node_modules"));
}

/**
 * Parses a source as its extension says. An Astro component parses as TypeScript, each unit on its own over the
 * component's text with every other character blanked, so offsets and lines are the original's. Its frontmatter may
 * return, as Astro allows. With `markup`, the units include the markup's expressions, and the comments its HTML comments.
 * @param {string} path
 * @param {string} text
 * @param {import("oxc-parser").ParserOptions & { markup?: boolean }} [options]
 * @returns {Pick<ReturnType<typeof parseSync>, "program" | "errors"> & { comments: Array<ReturnType<typeof parseSync>["comments"][number] | HtmlComment>, text: string }} `text` is what was parsed.
 */
export function parseSource(path, text, { markup = false, ...options } = {}) {
  if (!ASTRO.test(path)) {
    const { program, comments, errors } = parseSync(path, text, options);
    return { program, comments, errors, text };
  }
  const { units, html, problems } = astroUnits(text, markup);
  const parsed = units.map((unit) => {
    const { program, comments, errors } = parseSync(path, lay(text, unit.patches), { ...options, lang: unit.lang, sourceType: "module" });
    return { program, comments, errors: unit.frontmatter ? errors.filter((error) => !error.message.startsWith(TOP_LEVEL_RETURN)) : errors };
  });
  const program = { type: "Program", start: 0, end: text.length, sourceType: "module", hashbang: null, body: parsed.flatMap((result) => result.program.body) };
  return {
    program: /** @type {any} */ (program),
    comments: [...html, ...parsed.flatMap((result) => result.comments)],
    errors: [...problems.map((message) => /** @type {any} */ ({ severity: "Error", message, labels: [], helpMessage: null, codeframe: null })), ...parsed.flatMap((result) => result.errors)],
    text: lay(text, units.flatMap((unit) => unit.patches)),
  };
}

/**
 * @param {string} text
 * @param {readonly Patch[]} patches
 * @returns {string} The text with each character a space, newlines kept, and the patches laid over it. Where two units'
 * stand-ins meet, as `]` and `[0` can at an element's end, the first wins; neither holds a newline.
 */
function lay(text, patches) {
  const blank = text.replace(/[^\n]/g, " ");
  let laid = "";
  let at = 0;
  for (const patch of patches.toSorted((a, b) => a.at - b.at)) {
    if (patch.at < at) continue;
    laid += blank.slice(at, patch.at) + patch.code;
    at = patch.at + patch.code.length;
  }
  return laid + blank.slice(at);
}

/** The characters that open an attribute's value, by its kind, after its name and `=`. */
const OPENINGS = { quoted: /[^\s=]+\s*=\s*(["'])/y, expression: /[^\s=]+\s*=\s*(\{)/y, "template-literal": /[^\s=]+\s*=\s*(`)/y };
const CLOSINGS = { '"': '"', "'": "'", "{": "}", "`": "`" };

/**
 * @param {string} text
 * @param {boolean} markup
 * @returns {{ units: Unit[], html: HtmlComment[], problems: string[] }} The frontmatter's code, and the body of each
 * script a browser runs, is:inline and define:vars ones included, as the Astro compiler reads them. A quoted set:html or
 * set:text replaces a script's body, so its value is the body. With `markup`, also each expression in the markup and in
 * its attributes, where an element inside an expression stands in as `0`, and each HTML comment, those in is:raw and
 * quoted set:html content included. `problems` are what the checks cannot read.
 */
function astroUnits(text, markup) {
  const { ast } = parseAstro(text, { position: true });
  const index = byteIndex(text);
  /** @type {Unit[]} */
  const units = [];
  /** @type {HtmlComment[]} */
  const html = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {(start: number, end: number) => Patch} */
  const original = (start, end) => ({ at: start, code: text.slice(start, end) });
  /** @type {(patches: Patch[]) => void} */
  const unit = (patches) => units.push({ patches, lang: "tsx", frontmatter: false });
  /** @type {(node: { position?: import("@astrojs/compiler/types").Position }) => void} */
  const unreadable = (node) => void problems.push(`the markup on line ${node.position?.start.line} holds code the compiler places where the text does not have it, which no check can read`);

  /** @type {(attribute: import("@astrojs/compiler/types").AttributeNode) => Region | null} Where the value sits, or null when the text there is not the value the compiler read. */
  const valueOf = (attribute) => {
    const opening = OPENINGS[/** @type {keyof typeof OPENINGS} */ (attribute.kind)];
    if (!opening || !attribute.position) return null;
    opening.lastIndex = index(attribute.position.start.offset);
    const open = opening.exec(text)?.[1];
    const start = opening.lastIndex;
    const end = start + attribute.value.length;
    return open && text.slice(start, end) === attribute.value && text[end] === CLOSINGS[/** @type {keyof typeof CLOSINGS} */ (open)] ? { start, end } : null;
  };

  /** @type {(start: number, value: string) => void} The HTML comments in raw HTML, parsed as the markup is. */
  const raw = (start, value) => {
    const local = byteIndex(value);
    /** @param {import("@astrojs/compiler/types").Node} node */
    const visit = (node) => {
      if (node.type === "comment" && node.position) html.push(comment(node.value, start + local(node.position.start.offset)));
      if ("children" in node) node.children.forEach(visit);
    };
    visit(parseAstro(value, { position: true }).ast);
  };

  /** @param {import("@astrojs/compiler/types").AttributeNode} attribute */
  const attribute = (attribute) => {
    if (attribute.kind === "expression") {
      const value = valueOf(attribute);
      if (!value) return unreadable(attribute);
      unit([{ at: value.start - 1, code: "[" }, original(value.start, value.end), { at: value.end, code: "]" }]);
    } else if (attribute.kind === "template-literal") {
      const value = valueOf(attribute);
      if (!value) return unreadable(attribute);
      unit([original(value.start - 1, value.end + 1)]);
    } else if ((attribute.kind === "shorthand" || attribute.kind === "spread") && attribute.position) {
      const from = index(attribute.position.start.offset);
      const start = attribute.kind === "spread" ? from - "...".length : text.indexOf(attribute.name, from);
      const code = attribute.kind === "spread" ? `...${attribute.name}` : attribute.name;
      if (start < 1 || text.slice(start, start + code.length) !== code || text.slice(Math.min(start, from), start).trim() !== "") return unreadable(attribute);
      unit([{ at: start - 1, code: "[" }, original(start, start + code.length), { at: start + code.length, code: "]" }]);
    }
  };

  /** @param {import("@astrojs/compiler/types").ExpressionNode} node */
  const expression = (node) => {
    /** @type {Array<{ child: number, start: number, end: number }>} */
    const texts = [];
    for (const [child, part] of node.children.entries()) {
      if (part.type !== "text" || !part.position) continue;
      const start = index(part.position.start.offset);
      if (text.slice(start, start + part.value.length) !== part.value) return unreadable(node);
      texts.push({ child, start, end: start + part.value.length });
    }
    const [first, last] = [texts[0], texts.at(-1)];
    if (!first || !last) return;
    const opens = first.child === 0;
    const closes = last.child === node.children.length - 1;
    if ((opens && text[first.start - 1] !== "{") || (closes && text[last.end] !== "}")) return unreadable(node);
    /** @type {Patch[]} */
    const patches = [opens ? { at: first.start - 1, code: "[" } : { at: first.start - 2, code: "[0" }];
    for (const [position, piece] of texts.entries()) {
      patches.push(original(piece.start, piece.end));
      const next = texts[position + 1];
      if (next && next.child > piece.child + 1) patches.push({ at: piece.end, code: "0" });
    }
    patches.push(closes ? { at: last.end, code: "]" } : { at: last.end, code: "0]" });
    unit(patches);
  };

  /** @type {(node: import("@astrojs/compiler/types").Node, scripts: boolean) => void} `scripts` is false inside noscript, where no script runs. */
  const visit = (node, scripts) => {
    if (node.type === "frontmatter" && node.position) {
      const start = index(node.position.start.offset + "---".length);
      const end = start + node.value.length;
      units.push({ patches: [original(start, end)], lang: "ts", frontmatter: true });
      if (!text.startsWith("---", end)) problems.push("the frontmatter has no closing --- fence");
    }
    if (markup && node.type === "comment" && node.position) html.push(comment(node.value, index(node.position.start.offset)));
    if (markup && node.type === "expression") expression(node);
    if (node.type === "element" || node.type === "component" || node.type === "custom-element" || node.type === "fragment") {
      if (markup) node.attributes.forEach(attribute);
      if (node.name === "script") return scripts ? script(node) : undefined;
      if (node.name === "style") return;
      if (node.attributes.some((attribute) => attribute.name === "is:raw")) {
        if (!markup) return;
        for (const child of node.children) {
          if (child.type !== "text" || !child.position) return unreadable(node);
          const start = index(child.position.start.offset);
          if (text.slice(start, start + child.value.length) !== child.value) return unreadable(node);
          raw(start, child.value);
        }
        return;
      }
      const injected = node.attributes.find((attribute) => attribute.name === "set:html" && attribute.kind === "quoted");
      if (markup && injected) {
        const value = valueOf(injected);
        if (!value) return unreadable(injected);
        raw(value.start, injected.value);
      }
      if (node.name === "noscript") return node.children.forEach((child) => visit(child, false));
    }
    if ("children" in node) node.children.forEach((child) => visit(child, scripts));
  };

  /** @param {{ attributes: import("@astrojs/compiler/types").AttributeNode[], children: import("@astrojs/compiler/types").Node[] }} node */
  const script = (node) => {
    if (!runs(node.attributes)) return;
    const replaced = node.attributes.find((attribute) => attribute.name === "set:html" || attribute.name === "set:text");
    if (replaced) {
      const line = replaced.position?.start.line;
      if (replaced.kind === "empty") return;
      if (replaced.kind !== "quoted" || !replaced.position) {
        problems.push(`a script on line ${line} sets its body with a ${replaced.name} expression, which no check can read. Write the code as the script's body`);
        return;
      }
      const value = valueOf(replaced);
      if (!value) {
        problems.push(`a script on line ${line} sets its body with a ${replaced.name} value that is unquoted or holds HTML character references, which no check can read as written. Write the code as the script's body`);
        return;
      }
      units.push({ patches: [original(value.start, value.end)], lang: "ts", frontmatter: false });
      return;
    }
    const body = node.children.flatMap((child) => (child.type === "text" && child.position?.end ? [child.position] : []));
    const [first, last] = [body[0], body.at(-1)];
    if (first && last?.end) {
      const start = index(first.start.offset);
      units.push({ patches: [original(start, index(last.end.offset))], lang: "ts", frontmatter: false });
    }
  };

  visit(ast, true);
  return { units, html, problems };
}

/** @type {(value: string | undefined, start: number) => HtmlComment} The compiler gives a bogus comment such as `</ x>` no value. */
function comment(value = "", start) {
  return { type: "Html", value, start, end: start + value.length };
}

/** @type {(text: string) => (offset: number) => number} The string index of a UTF-8 byte offset, which is what the compiler reports. */
function byteIndex(text) {
  const bytes = Buffer.from(text);
  return (offset) => bytes.subarray(0, offset).toString().length;
}

/** @type {(attributes: import("@astrojs/compiler/types").AttributeNode[]) => boolean} Whether a script's type is one a browser runs. An expression type is unknown, so it is not. */
function runs(attributes) {
  const type = attributes.find((attribute) => attribute.name.toLowerCase() === "type");
  if (!type) return true;
  return (type.kind === "quoted" || type.kind === "empty") && SCRIPT_TYPES.has(type.value.trim().toLowerCase());
}
