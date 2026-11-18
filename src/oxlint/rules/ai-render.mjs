import { posix } from "node:path";

import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { directives } from "../functions.mjs";

const OWNER = /(?:^|\/)(?:src\/)?lib\/ai(?:\.server|\.browser)?(?:\.[cm]?[jt]sx?)?$/;
const ROUTE = /(?:^|\/)route\.[cm]?[jt]sx?$/;

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: {"description": "Only \"use server\" files, route handlers and src/lib/ai itself import src/lib/ai.", "fix": "Generate in a Server Action or route handler and store the result."}, schema: [], messages: { render: "Call {{names}} only from a \"use server\" file or a route handler and store the result, so render reads what was stored and never generates." } },
  create(context) {
    const path = productPath(context);
    if (NOT_PRODUCT.test(path) || ROUTE.test(path) || /(?:^|\/)src\/lib\/ai(?:\.server|\.browser)?\.[cm]?[jt]sx?$/.test(path)) return {};
    /** @param {string} specifier */
    const owner = (specifier) => OWNER.test(specifier.startsWith(".") ? posix.join(posix.dirname(path), specifier) : specifier);
    /** @type {{ node: any, names: string }[]} */
    const sites = [];
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !owner(node.source.value)) return;
        const names = node.specifiers.filter((specifier) => specifier.type !== "ImportSpecifier" || specifier.importKind !== "type").map((specifier) => specifier.type === "ImportSpecifier" ? specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value : specifier.local.name);
        sites.push({ node, names: names.join(", ") || node.source.value });
      },
      ExportNamedDeclaration(node) {
        if (node.source && node.exportKind !== "type" && owner(node.source.value)) sites.push({ node, names: node.specifiers.map((specifier) => specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value).join(", ") });
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type" && owner(node.source.value)) sites.push({ node, names: `the exports of ${node.source.value}` });
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string" && owner(node.source.value)) sites.push({ node, names: `the exports of ${node.source.value}` });
      },
      "Program:exit"(program) {
        if (directives(program).includes("use server")) return;
        for (const { node, names } of sites) context.report({ node, messageId: "render", data: { names } });
      },
    };
  },
});
