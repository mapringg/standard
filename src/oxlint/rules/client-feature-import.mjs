import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { projectFile, shipsToBrowser, staticText } from "../browser.mjs";
import { keyName } from "../hooks.mjs";

const FEATURE = /^(.*\/src\/features\/)([^/]+)\//;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "Code in src/features/<a> that ships to the browser imports nothing from another src/features/<b>, through its index or otherwise. Routes in src/app compose features.", fix: "Move the shared pieces to src/lib or src/components/<group>." }, schema: [], messages: { feature: "Move {{names}} out of src/features/{{target}} into src/lib or src/components/<group> and import {{them}} from there. This file ships to the browser from src/features/{{own}}, so importing another feature bundles that feature into every page that loads this one; features meet only in src/app routes." } },
  create(context) {
    const own = FEATURE.exec(context.filename.split("\\").join("/"));
    if (!own || NOT_PRODUCT.test(productPath(context))) return {};
    /** @type {boolean | undefined} */
    let browser;
    /** @param {any} node @param {string | undefined} source @param {string[]} names */
    const check = (node, source, names = []) => {
      const target = source === undefined ? undefined : FEATURE.exec((projectFile(context.filename, source) ?? "").split("\\").join("/"));
      if (!target || target[1] !== own[1] || target[2] === own[2]) return;
      browser ??= shipsToBrowser(context);
      if (browser) context.report({ node, messageId: "feature", data: { names: names.length ? names.join(", ") : `what this file uses from ${source}`, them: names.length === 1 ? "it" : "them", target: target[2], own: own[2] } });
    };
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const values = node.specifiers.filter((specifier) => specifier.type !== "ImportSpecifier" || specifier.importKind !== "type");
        if (node.specifiers.length && !values.length) return;
        check(node, node.source.value, values.every((specifier) => specifier.type === "ImportSpecifier") ? values.map((specifier) => keyName(/** @type {any} */ (specifier).imported)) : []);
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === "type" || !node.source) return;
        const values = node.specifiers.filter((specifier) => specifier.exportKind !== "type");
        if (values.length) check(node, node.source.value, values.map((specifier) => keyName(specifier.local)));
      },
      ExportAllDeclaration(node) { if (node.exportKind !== "type") check(node, node.source.value); },
      ImportExpression(node) { check(node, staticText(node.source)); },
      CallExpression(node) { if (node.callee.type === "Identifier" && node.callee.name === "require") check(node, staticText(node.arguments[0])); },
    };
  },
});
