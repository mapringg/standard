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

/** @param {Node} program @returns {Node[]} The functions a module exports by declaration. */
export function exportedFunctions(program) {
  return program.body.flatMap((/** @type {Node} */ node) => {
    if (node.type === "ExportDefaultDeclaration") return isFunction(node.declaration) ? [node.declaration] : [];
    if (node.type !== "ExportNamedDeclaration" || !node.declaration) return [];
    if (isFunction(node.declaration)) return [node.declaration];
    return node.declaration.type === "VariableDeclaration" ? node.declaration.declarations.flatMap((/** @type {Node} */ item) => isFunction(item.init) ? [item.init] : []) : [];
  });
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
