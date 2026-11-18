import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { EFFECT, rolesOf, withSegment } from "../roles.mjs";
import { EFFECT_HOOKS as HOOKS, called, hookName, keyName as nameOf, reactNamespace } from "../hooks.mjs";

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: {
    type: "problem",
    schema: [],
    messages: {
      name: "Replace the effect with what it does, or name the file {{name}} when it keeps an outside system in step, reacts to the route or subscribes.",
      pass: "Export the hook that calls the effect, never the effect hook itself, so every file that runs an effect carries an effect name.",
    },
  },
  create(context) {
    const path = productPath(context);
    if (NOT_PRODUCT.test(path)) return {};
    const named = /(?:^|\/)src\/lib\/timer\.ts$/.test(path) || rolesOf(context.filename).effect.length > 0;
    const data = { name: withSegment(path, `effect-<${EFFECT.join("|")}>`) };
    /** @param {any} node */
    const use = (node) => { if (!named) context.report({ node, messageId: "name", data }); };
    /** @param {any} node */
    const pass = (node) => { if (!called(node) && hookName(context, node)) context.report({ node, messageId: "pass" }); };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react" || node.importKind === "type") return;
        for (const specifier of node.specifiers) if (specifier.type === "ImportSpecifier" && specifier.importKind !== "type" && HOOKS.includes(nameOf(specifier.imported))) use(specifier);
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind !== "type" && node.source?.value === "react") for (const specifier of node.specifiers) if (HOOKS.includes(nameOf(specifier.local))) context.report({ node: specifier, messageId: "pass" });
      },
      ExportAllDeclaration(node) {
        if (node.source.value === "react" && node.exportKind !== "type") context.report({ node, messageId: "pass" });
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !reactNamespace(context, node.init)) return;
        for (const property of node.id.properties) if (property.type === "Property" && HOOKS.includes(nameOf(property.key))) use(property);
      },
      MemberExpression(node) {
        const name = !node.computed && node.property.type === "Identifier" ? node.property.name : node.property.type === "Literal" ? node.property.value : undefined;
        if (typeof name === "string" && HOOKS.includes(name)) use(node);
        pass(node);
      },
      Identifier: pass,
    };
  },
});
