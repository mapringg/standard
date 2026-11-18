/** @typedef {any} Node */

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** @param {Node} node @returns {string[]} The directives at the top of a program or function body. */
export function directives(node) {
  const body = node?.type === "Program" ? node.body : node?.body?.type === "BlockStatement" || node?.body?.type === "FunctionBody" ? node.body.body : [];
  const found = [];
  for (const statement of body) {
    if (statement.type !== "ExpressionStatement" || typeof statement.directive !== "string") break;
    found.push(statement.directive);
  }
  return found;
}

/** @param {Node} node */
export const isFunction = (node) => FUNCTIONS.has(node?.type);

/**
 * @param {Node} program
 * @returns {{ functions: Node[], others: Node[] }} The inline functions a module exports, and every other value export, such as
 *   `export { f }`, `export default f`, an export of a call, or a re-export. Type exports are neither.
 */
export function moduleExports(program) {
  /** @type {{ functions: Node[], others: Node[] }} */
  const found = { functions: [], others: [] };
  for (const node of program.body) {
    if (node.exportKind === "type") continue;
    if (node.type === "ExportAllDeclaration") found.others.push(node);
    else if (node.type === "ExportDefaultDeclaration") (isFunction(node.declaration) ? found.functions : found.others).push(node.declaration);
    else if (node.type === "ExportNamedDeclaration") {
      const declaration = node.declaration;
      if (!declaration) {
        if (node.specifiers.some((/** @type {Node} */ specifier) => specifier.exportKind !== "type")) found.others.push(node);
      } else if (isFunction(declaration)) found.functions.push(declaration);
      else if (declaration.type === "VariableDeclaration") for (const item of declaration.declarations) {
        if (isFunction(item.init)) found.functions.push(item.init);
        else found.others.push(item);
      }
      else if (!/^TS(?:Interface|TypeAlias|Module)Declaration$/.test(declaration.type)) found.others.push(declaration);
    }
  }
  return found;
}

/** @param {Node} fn @returns {Node[]} A function's top-level statements; an expression body counts as one. */
export const statements = (fn) => fn.body?.type === "BlockStatement" || fn.body?.type === "FunctionBody" ? fn.body.body.filter((/** @type {Node} */ statement) => typeof statement.directive !== "string") : [{ type: "ExpressionStatement", expression: fn.body }];

/** @param {unknown} node @param {(node: Node) => boolean | void} enter Visits every node below a root, until enter returns true. */
export function walk(node, enter) {
  if (!node || typeof node !== "object" || enter(node) === true) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) for (const item of value) walk(item, enter);
    else walk(value, enter);
  }
}
