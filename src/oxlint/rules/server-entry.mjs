import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { projectFile, shipsToBrowser, staticText } from "../browser.mjs";

const SERVER = /(?:^|[\\/])[^\\/]+\.server(?:\.[^\\/]+)?$/;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "Code that ships to the browser imports no *.server.* file, however the import resolves.", fix: "Import the module's index entry, or keep the import in server code." }, schema: [], messages: { entry: "Keep {{source}} out of this file, which ships to the browser: a *.server.* file is server-only. Import the module's index entry, or move the import to server code." } },
  create(context) {
    if (NOT_PRODUCT.test(productPath(context))) return {};
    /** @type {boolean | undefined} */
    let browser;
    /** @param {any} node @param {string | undefined} source */
    const check = (node, source) => {
      if (source === undefined || !SERVER.test(projectFile(context.filename, source) ?? source)) return;
      browser ??= shipsToBrowser(context);
      if (browser) context.report({ node, messageId: "entry", data: { source } });
    };
    return {
      ImportDeclaration(node) { if (node.importKind !== "type") check(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.exportKind !== "type" && node.source) check(node, node.source.value); },
      ExportAllDeclaration(node) { if (node.exportKind !== "type") check(node, node.source.value); },
      ImportExpression(node) { check(node, staticText(node.source)); },
      CallExpression(node) { if (node.callee.type === "Identifier" && node.callee.name === "require") check(node, staticText(node.arguments[0])); },
    };
  },
});
