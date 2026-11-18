import { existsSync, readFileSync, globSync } from "node:fs";
import { dirname, join, matchesGlob, relative, sep } from "node:path";
import { parseSync } from "oxc-parser";

import { NOT_PRODUCT } from "../checks/support/packages.mjs";

/** @param {{ filename: string, cwd: string }} context */
export const productPath = (context) => relative(context.cwd, context.filename).split(sep).join("/");

/** @param {string} filename @param {string} cwd */
function packageRoot(filename, cwd) {
  for (let folder = dirname(filename); ; folder = dirname(folder)) {
    if (existsSync(join(folder, "package.json")) || folder === cwd || dirname(folder) === folder) return folder;
  }
}

/** @param {string} root @param {string} owner */
function ownerMessage(root, owner) {
  const variants = [owner, owner.replace(/\.ts$/, ".server.ts"), owner.replace(/\.ts$/, ".browser.ts")];
  const files = owner.includes("*") ? globSync(owner, { cwd: root }).filter((path) => /\.[cm]?[jt]sx?$/.test(path)) : variants.filter((path) => existsSync(join(root, path)));
  const exports = files.flatMap((path) => {
    const { program } = parseSync(path, readFileSync(join(root, path), "utf8"));
    return program.body.flatMap((node) => {
      if (node.type === "ExportDefaultDeclaration") return [`default from ${path}`];
      if (node.type !== "ExportNamedDeclaration" || node.exportKind === "type") return [];
      const declaration = node.declaration;
      const names = declaration?.type === "VariableDeclaration"
        ? declaration.declarations.flatMap(({ id }) => id.type === "Identifier" ? [id.name] : [])
        : declaration && "id" in declaration && declaration.id && "name" in declaration.id ? [declaration.id.name] : [];
      return [...names, ...node.specifiers.map(({ exported }) => exported.type === "Identifier" ? exported.name : exported.value)].map((name) => `${name} from ${path}`);
    });
  });
  return exports.length ? `Import ${exports.join("; ")}.` : `Put the owner at ${owner} and import its exports.`;
}

/** @typedef {Parameters<NonNullable<ReturnType<NonNullable<Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]["create"]>>[string]>>[0]} Node */

/** @param {Node} node @returns {string} */
function chain(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MetaProperty") return `${node.meta.name}.${node.property.name}`;
  if (node.type !== "MemberExpression") return "";
  const property = node.property;
  const key = !node.computed && property.type === "Identifier" ? property.name : property.type === "Literal" ? String(property.value) : "";
  return `${chain(node.object)}.${key}`.replace(/^(?:window|globalThis|self|global)\./, "");
}

/**
 * @param {{ owner: string, modules: string[], globals: string[], properties: string[] }} definition
 * @returns {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]}
 */
export function fixedPathRule({ owner, modules, globals, properties }) {
  return {
    meta: { type: "problem", schema: [], messages: { owner: "{{fix}}" } },
    create(context) {
      const filename = context.filename;
      const root = packageRoot(filename, context.cwd);
      const path = relative(root, filename).split(sep).join("/");
      if (NOT_PRODUCT.test(productPath(context)) || matchesGlob(path.replace(/\.(?:server|browser)\.ts$/, ".ts"), owner)) return {};
      /** @param {Node} node */
      const report = (node) => context.report({ node, messageId: "owner", data: { fix: ownerMessage(root, owner) } });
      /** @param {Node} node @param {unknown} value */
      const checkModule = (node, value) => {
        if (typeof value === "string" && modules.some((pattern) => matchesGlob(value, pattern))) report(node);
      };
      return {
        ImportDeclaration(node) {
          if (node.importKind !== "type") checkModule(node, node.source.value);
        },
        ExportNamedDeclaration(node) {
          if (node.exportKind !== "type") checkModule(node, node.source?.value);
        },
        ExportAllDeclaration(node) {
          if (node.exportKind !== "type") checkModule(node, node.source.value);
        },
        ImportExpression(node) { checkModule(node, node.source.type === "Literal" ? node.source.value : undefined); },
        CallExpression(node) {
          if (node.callee.type === "Identifier" && node.callee.name === "require") {
            const first = node.arguments[0];
            checkModule(node, first?.type === "Literal" ? first.value : undefined);
          }
        },
        MemberExpression(node) {
          const name = chain(node);
          if (globals.includes(name) || properties.includes(name.split(".").at(-1) ?? "")) report(node);
        },
        Identifier(node) {
          if (!globals.includes(node.name)) return;
          const scope = context.sourceCode.getScope(node);
          const variable = scope.references.find((reference) => reference.identifier === node);
          if (variable && !variable.resolved?.defs.length) report(node);
        },
      };
    },
  };
}
