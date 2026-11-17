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
  const { frontmatter, scripts, problems } = astroRegions(text);
  const regions = frontmatter ? [frontmatter, ...scripts] : scripts;
  const parsed = regions.map((region) => {
    const { program, comments, errors } = parseSync(path, blank(text, [region]), { ...options, lang: "ts", sourceType: "module" });
    return { program, comments, errors: region === frontmatter ? errors.filter((error) => !error.message.startsWith(TOP_LEVEL_RETURN)) : errors };
  });
  const program = { type: "Program", start: 0, end: text.length, sourceType: "module", hashbang: null, body: parsed.flatMap((result) => result.program.body) };
  return {
    program: /** @type {any} */ (program),
    comments: parsed.flatMap((result) => result.comments),
    errors: [...problems.map((message) => /** @type {any} */ ({ severity: "Error", message, labels: [], helpMessage: null, codeframe: null })), ...parsed.flatMap((result) => result.errors)],
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
 * @returns {{ frontmatter: Region | null, scripts: Region[], problems: string[] }} The frontmatter's code, and the body
 * of each script a browser runs, is:inline and define:vars ones included, as the Astro compiler reads them. A quoted
 * set:html or set:text replaces a script's body, so its value is the body. `problems` are what the checks cannot read.
 */
function astroRegions(text) {
  const { ast } = parseAstro(text, { position: true });
  const bytes = Buffer.from(text);
  /** @type {(offset: number) => number} The string index of a UTF-8 byte offset, which is what the compiler reports. */
  const index = (offset) => bytes.subarray(0, offset).toString().length;
  /** @type {Region | null} */
  let frontmatter = null;
  /** @type {Region[]} */
  const scripts = [];
  /** @type {string[]} */
  const problems = [];
  /** @param {import("@astrojs/compiler/types").Node} node */
  const visit = (node) => {
    if (node.type === "frontmatter" && node.position) {
      const start = node.position.start.offset + "---".length;
      frontmatter = { start: index(start), end: index(start + Buffer.byteLength(node.value)) };
      if (!text.startsWith("---", frontmatter.end)) problems.push("the frontmatter has no closing --- fence");
    }
    if (node.type === "element" && node.name === "noscript") return;
    if (node.type === "element" && node.name === "script") {
      if (!runs(node.attributes)) return;
      const replaced = node.attributes.find((attribute) => attribute.name === "set:html" || attribute.name === "set:text");
      if (replaced) {
        const at = replaced.position && replaced.raw ? text.indexOf(replaced.raw, index(replaced.position.start.offset)) : -1;
        if (replaced.kind === "quoted" && replaced.raw && at >= 0) scripts.push({ start: at + 1, end: at + replaced.raw.length - 1 });
        else if (replaced.kind !== "empty") problems.push(`a script on line ${replaced.position?.start.line} sets its body with a ${replaced.name} expression, which no check can read. Write the code as the script's body`);
        return;
      }
      const body = node.children.flatMap((child) => (child.type === "text" && child.position?.end ? [child.position] : []));
      const [first, last] = [body[0], body.at(-1)];
      if (first && last?.end) scripts.push({ start: index(first.start.offset), end: index(last.end.offset) });
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(ast);
  return { frontmatter, scripts, problems };
}

/** @type {(attributes: import("@astrojs/compiler/types").AttributeNode[]) => boolean} Whether a script's type is one a browser runs. An expression type is unknown, so it is not. */
function runs(attributes) {
  const type = attributes.find((attribute) => attribute.name.toLowerCase() === "type");
  if (!type) return true;
  return (type.kind === "quoted" || type.kind === "empty") && SCRIPT_TYPES.has(type.value.trim().toLowerCase());
}
