import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { EFFECT, rolesOf, withSegment } from "../roles.mjs";

const HOOKS = ["useEffect", "useLayoutEffect"];

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { name: "Replace the effect with what it does, or name the file {{name}} when it keeps an outside system in step, reacts to the route or subscribes." } },
  create(context) {
    const path = productPath(context);
    if (NOT_PRODUCT.test(path) || /(?:^|\/)src\/lib\/timer\.ts$/.test(path) || rolesOf(context.filename).effect.length) return {};
    const data = { name: withSegment(path, `effect-<${EFFECT.join("|")}>`) };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react" || node.importKind === "type") return;
        for (const specifier of node.specifiers) {
          const name = specifier.type === "ImportSpecifier" ? specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value : "";
          if (HOOKS.includes(name)) context.report({ node: specifier, messageId: "name", data });
        }
      },
      MemberExpression(node) {
        const name = !node.computed && node.property.type === "Identifier" ? node.property.name : node.property.type === "Literal" ? node.property.value : undefined;
        if (typeof name === "string" && HOOKS.includes(name)) context.report({ node, messageId: "name", data });
      },
    };
  },
});
