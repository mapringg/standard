import { matchesGlob, posix, relative, sep } from "node:path";

import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { projectFile, staticText } from "../browser.mjs";
import { apiModules } from "../roles.mjs";

const SERVER = /(?:^|\/)[^/]+\.server(?:\.[^/]*)?$/;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "A plain index imports and re-exports no *.server.* file or API module, however the import resolves.", fix: "Move the export to the module's index.server entry." }, schema: [], messages: { server: "Move {{source}} to this module's index.server entry; a plain index may reach the browser, so it carries no *.server.* file or API module." } },
  create(context) {
    const path = productPath(context);
    if (NOT_PRODUCT.test(path) || !/^index\.[cm]?[jt]sx?$/.test(posix.basename(path))) return {};
    const api = apiModules(context.filename);
    /** @param {any} node @param {string | undefined} source */
    const check = (node, source) => {
      if (source === undefined) return;
      const resolved = projectFile(context.filename, source);
      const target = resolved === undefined ? source : relative(api.root, resolved).split(sep).join("/");
      if (SERVER.test(target) || resolved !== undefined && api.globs.some((glob) => matchesGlob(target, glob))) context.report({ node, messageId: "server", data: { source } });
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
