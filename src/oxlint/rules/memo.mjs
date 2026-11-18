import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { compiler: "Let React Compiler memoize this code." } },
  create(context) {
    if (NOT_PRODUCT.test(productPath(context))) return {};
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react" || node.importKind === "type") return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
          const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
          if (["useMemo", "useCallback", "memo"].includes(name)) context.report({ node: specifier, messageId: "compiler" });
        }
      },
      MemberExpression(node) {
        const name = !node.computed && node.property.type === "Identifier" ? node.property.name : node.property.type === "Literal" ? node.property.value : undefined;
        if (typeof name === "string" && ["useMemo", "useCallback", "memo"].includes(name)) context.report({ node, messageId: "compiler" });
      },
    };
  },
});
