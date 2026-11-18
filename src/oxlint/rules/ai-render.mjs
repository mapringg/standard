import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseSync } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";

import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { directives, isFunction, walk } from "../functions.mjs";

/** @typedef {import("../functions.mjs").Node} Node */

const OWNER = /\/src\/lib\/ai(?:\.server|\.browser)?\.[cm]?[jt]sx?$/;
const resolver = new ResolverFactory({ tsconfig: "auto", conditionNames: ["import", "default"], extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"], extensionAlias: { ".js": [".ts", ".tsx", ".js"] } });
/** @type {Map<string, boolean>} */
const generation = new Map();

/** @param {string} file @param {string} specifier */
const resolve = (file, specifier) => resolver.resolveFileSync(file, specifier).path;

/** @param {string | undefined} file @returns {boolean} Whether a module is the AI owner or re-exports a value from one. */
function generates(file) {
  if (!file || file.includes("/node_modules/")) return false;
  if (OWNER.test(file)) return true;
  if (generation.has(file)) return generation.get(file) ?? false;
  generation.set(file, false);
  const { program } = parseSync(file, readFileSync(file, "utf8"));
  /** @type {Map<string, string | undefined>} */
  const imported = new Map();
  for (const node of program.body) if (node.type === "ImportDeclaration" && node.importKind !== "type") for (const specifier of node.specifiers) imported.set(specifier.local.name, node.source.value);
  const found = program.body.some((/** @type {Node} */ node) => {
    if ((node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && node.exportKind !== "type" && node.source) return generates(resolve(file, node.source.value));
    if (node.type !== "ExportNamedDeclaration" || node.source || node.exportKind === "type") return false;
    return node.specifiers.some((/** @type {Node} */ specifier) => {
      const source = imported.get(specifier.local.name);
      return source !== undefined && generates(resolve(file, source));
    });
  });
  generation.set(file, found);
  return found;
}

/** @param {string} filename */
function inNext(filename) {
  for (let folder = dirname(filename); dirname(folder) !== folder; folder = dirname(folder)) {
    const path = join(folder, "package.json");
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    return Boolean(manifest.dependencies?.next || manifest.devDependencies?.next);
  }
  return false;
}

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { render: "Call {{names}} from a Server Action or route handler and store the result, so render reads what was stored and never generates." } },
  create(context) {
    if (NOT_PRODUCT.test(productPath(context)) || OWNER.test(context.filename)) return {};
    /** @type {{ node: Node, names: string }[]} */
    const sites = [];
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !generates(resolve(context.filename, node.source.value))) return;
        const names = node.specifiers.filter((/** @type {Node} */ specifier) => specifier.type !== "ImportSpecifier" || specifier.importKind !== "type").map((/** @type {Node} */ specifier) => specifier.type === "ImportSpecifier" ? specifier.imported.name ?? specifier.imported.value : specifier.local.name);
        if (names.length) sites.push({ node, names: names.join(", ") });
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string" && generates(resolve(context.filename, node.source.value))) sites.push({ node, names: `the exports of ${node.source.value}` });
      },
      "Program:exit"(program) {
        if (sites.length === 0) return;
        const top = directives(program);
        let cached = top.some((directive) => directive.startsWith("use cache"));
        walk(program, (node) => { cached ||= isFunction(node) && directives(node).some((directive) => directive.startsWith("use cache")); return cached; });
        const component = /\.[jt]sx$/.test(context.filename) && !top.includes("use client") && !top.includes("use server") && inNext(context.filename);
        if (cached || component) for (const { node, names } of sites) context.report({ node, messageId: "render", data: { names } });
      },
    };
  },
});
