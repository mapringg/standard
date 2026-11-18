import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { shipsToBrowser } from "../browser.mjs";

const ENTRY = /(?:^|\/)index\.server(?:\.[cm]?[jt]sx?)?$/;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "Code that ships to the browser imports no index.server entry.", fix: "Import the module's index entry, or keep the import in server code." }, schema: [], messages: { entry: "Import this module's index entry here; its index.server entry is server-only, and this file ships to the browser." } },
  create(context) {
    if (NOT_PRODUCT.test(productPath(context))) return {};
    /** @type {boolean | undefined} */
    let browser;
    /** @param {any} node @param {unknown} source */
    const check = (node, source) => {
      if (typeof source !== "string" || !ENTRY.test(source)) return;
      browser ??= shipsToBrowser(context);
      if (browser) context.report({ node, messageId: "entry" });
    };
    return {
      ImportDeclaration(node) { if (node.importKind !== "type") check(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.exportKind !== "type" && node.source) check(node, node.source.value); },
      ExportAllDeclaration(node) { if (node.exportKind !== "type") check(node, node.source.value); },
      ImportExpression(node) { if (node.source.type === "Literal") check(node, node.source.value); },
    };
  },
});
