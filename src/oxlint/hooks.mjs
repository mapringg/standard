export const EFFECT_HOOKS = ["useEffect", "useLayoutEffect", "useInsertionEffect"];

/** @param {any} node @returns {string} The static name of a key, property or import name. */
export const keyName = (node) => node?.type === "Identifier" ? node.name : node?.type === "Literal" ? String(node.value) : "";

/** @param {any} context @param {any} identifier @returns {any} The definition an identifier reference resolves to. */
function definition(context, identifier) {
  return context.sourceCode.getScope(identifier).references.find((/** @type {any} */ item) => item.identifier === identifier && item.isRead())?.resolved?.defs[0];
}

/** @param {any} context @param {any} node Whether the node is a default or namespace import of react. */
export function reactNamespace(context, node) {
  if (node?.type !== "Identifier") return false;
  const found = definition(context, node);
  return found?.type === "ImportBinding" && found.parent.source.value === "react" && found.parent.importKind !== "type" && found.node.type !== "ImportSpecifier";
}

/** @param {any} context @param {any} node @param {string[]} hooks @returns {string} The react hook an expression names, read through imports, namespaces, computed members and destructures. */
export function hookName(context, node, hooks = EFFECT_HOOKS) {
  /** @type {string} */
  let name = "";
  if (node?.type === "MemberExpression" && reactNamespace(context, node.object)) name = node.computed && node.property.type !== "Literal" ? "" : keyName(node.property);
  else if (node?.type === "Identifier") {
    const found = definition(context, node);
    if (found?.type === "ImportBinding" && found.node.type === "ImportSpecifier" && found.parent.source.value === "react" && found.parent.importKind !== "type" && found.node.importKind !== "type") name = keyName(found.node.imported);
    else if (found?.node?.type === "VariableDeclarator" && found.node.id.type === "ObjectPattern" && reactNamespace(context, found.node.init)) {
      const property = found.node.id.properties.find((/** @type {any} */ item) => item.type === "Property" && (item.value === found.name || item.value.type === "AssignmentPattern" && item.value.left === found.name));
      name = property && !(property.computed && property.key.type !== "Literal") ? keyName(property.key) : "";
    }
  }
  return hooks.includes(name) ? name : "";
}

/** @param {any} node Whether the node is the callee of a call. */
export const called = (node) => node.parent?.type === "CallExpression" && node.parent.callee === node;
