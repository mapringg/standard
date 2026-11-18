import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";

import { shipsToBrowser } from "../browser.mjs";

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { mini: "Import from zod/mini." } },
  create(context) {
    if (NOT_PRODUCT.test(productPath(context)) || !shipsToBrowser(context)) return {};
    /** @param {Parameters<NonNullable<ReturnType<NonNullable<Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]["create"]>>[string]>>[0]} node */
    const check = (node) => {
      if ("importKind" in node && node.importKind === "type" || "exportKind" in node && node.exportKind === "type") return;
      const source = "source" in node ? node.source : undefined;
      const value = source && "value" in source ? source.value : undefined;
      if (typeof value === "string" && (value === "zod" || value.startsWith("zod/") && value !== "zod/mini")) context.report({ node, messageId: "mini" });
    };
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check };
  },
});
