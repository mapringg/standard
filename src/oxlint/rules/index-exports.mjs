import { posix } from "node:path";

import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";

const SERVER = /(?:^|\/)[^/]+\.server(?:\.[^/]*)?$|(?:^|\/)lib\/api(?:\/|$)/;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "A plain index imports and re-exports no *.server.* file or src/lib/api module.", fix: "Move the export to the module's index.server entry." }, schema: [], messages: { server: "Move {{source}} to this module's index.server entry; a plain index may reach the browser, so it carries no *.server.* or src/lib/api module." } },
  create(context) {
    const path = productPath(context);
    if (NOT_PRODUCT.test(path) || !/^index\.[cm]?[jt]sx?$/.test(posix.basename(path))) return {};
    /** @param {any} node @param {unknown} source */
    const check = (node, source) => { if (typeof source === "string" && SERVER.test(source)) context.report({ node, messageId: "server", data: { source } }); };
    return {
      ImportDeclaration(node) { if (node.importKind !== "type") check(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.exportKind !== "type" && node.source) check(node, node.source.value); },
      ExportAllDeclaration(node) { if (node.exportKind !== "type") check(node, node.source.value); },
      ImportExpression(node) { if (node.source.type === "Literal") check(node, node.source.value); },
    };
  },
});
