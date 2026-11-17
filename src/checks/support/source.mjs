import { parseSync } from "oxc-parser";

import { GLOBAL_OBJECTS } from "../../config.mjs";
import { namesOf as names } from "../boundaries.mjs";

/**
 * @typedef {{ type: string, [key: string]: any }} Node
 *
 * One use of an API from outside the file. A "module" path is a specifier, or `specifier#export`, such as `react#useMemo`.
 * A "global" path is a dotted chain from an unshadowed global, such as `process.env.API_URL`. Kind "type" is a type-only import, which no rule counts.
 * @typedef {{ space: "module" | "global", path: string, kind: "import" | "type" | "read" | "call", line: number }} Use
 *
 * `members` holds the lines of each static property name read on any object, by member access or destructuring.
 * @typedef {{ path: string, uses: readonly Use[], members: ReadonlyMap<string, readonly number[]> }} Parsed
 * @typedef {Parsed | { path: string, error: string }} FileFacts
 *
 * What a chain names so far, and what a binding holds: an import, or a local that a static chain initialized. Other locals hold null. A module ref with a `namespace` is a namespace or default binding, whose next key names an export.
 * @typedef {{ space: "global", path: string } | { space: "module", path: string, namespace: string | null }} Ref
 *
 * A ref read once the whole file is walked, so a function may use a local declared below it. A cycle reads as null.
 * @typedef {() => Ref | null} Later
 */

/** Modules whose default or namespace binding is a global, and whose named exports are its members. */
const MODULE_GLOBALS = new Map([["process", "process"], ["node:process", "process"]]);

const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ChainExpression"]);

/** TypeScript nodes that hold a value expression. Every other TS node is a type, and the walk skips it. */
const VALUE_TS = new Set([...WRAPPERS, "TSInstantiationExpression", "TSEnumDeclaration", "TSExportAssignment", "TSModuleDeclaration"]);

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Nodes that hold no reference: imports, read once up front, labels, and a closing tag that repeats its opening tag. */
const SKIPPED = new Set(["ImportDeclaration", "ExportAllDeclaration", "BreakStatement", "ContinueStatement", "JSXClosingElement"]);

const SOURCE = /\.[cm]?[jt]sx?$/;

/** @type {(path: string) => Ref} */
const moduleRef = (path) => ({ space: "module", path, namespace: null });

/** @type {(read: Later) => Later} */
function later(read) {
  let known = /** @type {{ ref: Ref | null } | null} */ (null);
  return () => {
    if (known) return known.ref;
    known = { ref: null };
    return (known = { ref: read() }).ref;
  };
}

/** @type {(ref: Ref) => Later} */
const now = (ref) => () => ref;

/** @type {(ref: Later | null, key: string | null) => Later | null} */
const at = (ref, key) => (ref && key !== null ? later(() => { const base = ref(); return base && extend(base, key); }) : null);

/** @type {(statements: Node[]) => string[]} The names the statements declare in their own block. */
function declared(statements) {
  return statements.flatMap((statement) => {
    const node = statement.type.startsWith("Export") && statement.declaration ? statement.declaration : statement;
    if (node.declare) return [];
    if (node.type === "VariableDeclaration") return node.declarations.flatMap((/** @type {Node} */ item) => names(item.id));
    const named = ["FunctionDeclaration", "ClassDeclaration", "TSEnumDeclaration", "TSModuleDeclaration"].includes(node.type);
    return named && node.id?.type === "Identifier" ? [node.id.name] : [];
  });
}

/** @type {(node: unknown) => string[]} The `var` names that hoist to the function or program around node. */
function vars(node) {
  if (Array.isArray(node)) return node.flatMap(vars);
  const value = /** @type {Node | null} */ (node);
  if (typeof value?.type !== "string" || FUNCTIONS.has(value.type) || value.type.startsWith("TS")) return [];
  if (value.type === "VariableDeclaration" && value.kind === "var" && !value.declare) return value.declarations.flatMap((/** @type {Node} */ item) => names(item.id));
  return Object.values(value).flatMap((child) => (child && typeof child === "object" ? vars(child) : []));
}

/** @type {(node: Node) => string[] | null} The names a scope node binds for its body, or null when node opens no scope. */
function scopeNames(node) {
  if (FUNCTIONS.has(node.type)) return [...node.params.flatMap(names), ...(node.type === "FunctionExpression" ? names(node.id) : []), ...vars(node.body)];
  switch (node.type) {
    case "BlockStatement":
    case "StaticBlock": return declared(node.body);
    case "SwitchStatement": return declared(node.cases.flatMap((/** @type {Node} */ item) => item.consequent));
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement": return declared([node.init ?? node.left].filter((head) => head?.type === "VariableDeclaration"));
    case "CatchClause": return names(node.param);
    case "ClassDeclaration":
    case "ClassExpression": return names(node.id);
    case "TSModuleDeclaration": return node.body?.type === "TSModuleBlock" ? declared(node.body.body) : [];
    default: return null;
  }
}

/** @type {(key: Node, computed: boolean) => string | null} The property name a key states, or null when only runtime knows it. */
function keyOf(key, computed) {
  if (!computed && key.type !== "Literal") return key.name;
  if (key.type === "Literal" && ["string", "number"].includes(typeof key.value)) return String(key.value);
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) return key.quasis[0].value.cooked;
  return null;
}

/** @type {(ref: Ref, key: string) => Ref} */
function extend(ref, key) {
  if (ref.space === "global") return { space: "global", path: ref.path ? `${ref.path}.${key}` : key };
  return ref.namespace === null ? ref : moduleRef(`${ref.namespace}#${key}`);
}

/** @type {(binding: { module: string, imported: string }) => Ref} */
function importRef({ module, imported }) {
  const global = MODULE_GLOBALS.get(module);
  const whole = imported === "*" || imported === "default";
  if (global) return whole ? { space: "global", path: global } : extend({ space: "global", path: global }, imported);
  return whole ? { space: "module", path: imported === "*" ? module : `${module}#default`, namespace: module } : moduleRef(`${module}#${imported}`);
}

/** @type {(path: string, text: string) => FileFacts} */
function factsOf(path, text) {
  const { program, errors } = parseSync(path, text, { preserveParens: false });
  if (errors.length > 0) return { path, error: errors[0].message };
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  const lineOf = (/** @type {Node} */ node) => starts.findLastIndex((start) => start <= node.start) + 1;
  const pending = /** @type {{ ref: Later, kind: Use["kind"], line: number }[]} */ ([]);
  const members = /** @type {Map<string, number[]>} */ (new Map());
  const stack = /** @type {Map<string, Later | null>[]} */ ([]);

  /** @type {(ref: Later | null, kind: Use["kind"], node: Node) => void} */
  const emit = (ref, kind, node) => {
    if (ref) pending.push({ ref, kind, line: lineOf(node) });
  };
  /** @type {(key: string, node: Node) => void} */
  const note = (key, node) => {
    if (!members.has(key)) members.set(key, []);
    members.get(key)?.push(lineOf(node));
  };
  /** @type {(name: string) => Later} */
  const resolve = (name) => {
    const frame = stack.findLast((scope) => scope.has(name));
    return frame ? later(() => frame.get(name)?.() ?? null) : now({ space: "global", path: GLOBAL_OBJECTS.has(name) ? "" : name });
  };
  /** @type {(node: Node) => string | null} The module that `require("m")` or `await import("m")` loads. */
  const loaded = (node) => {
    const call = node.type === "AwaitExpression" ? node.argument : node;
    const required = call.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "require" && !stack.some((scope) => scope.has("require"));
    const source = required ? call.arguments[0] : call.type === "ImportExpression" && call !== node ? call.source : null;
    return typeof source?.value === "string" ? source.value : null;
  };

  const top = new Map(declared(program.body).concat(vars(program.body)).map((name) => [name, /** @type {Later | null} */ (null)]));
  for (const node of /** @type {Node[]} */ (program.body)) {
    const typeOnly = node.importKind === "type" || node.exportKind === "type";
    if (node.type === "TSImportEqualsDeclaration") {
      const module = node.moduleReference.expression?.value ?? null;
      if (module !== null) emit(now(moduleRef(module)), typeOnly ? "type" : "import", node);
      top.set(node.id.name, module === null || typeOnly ? null : now(importRef({ module, imported: "*" })));
    }
    if (!node.source) continue;
    const module = node.source.value;
    const specifiers = node.specifiers ?? [];
    const kindOf = (/** @type {Node} */ item) => (typeOnly || (item.importKind ?? item.exportKind) === "type" ? "type" : "import");
    const allTypes = specifiers.length > 0 && specifiers.every((/** @type {Node} */ item) => kindOf(item) === "type");
    emit(now(moduleRef(module)), typeOnly || allTypes ? "type" : "import", node);
    for (const specifier of specifiers) {
      const imported = specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.type === "ImportNamespaceSpecifier" ? "*"
        : /** @type {string} */ (keyOf(specifier.type === "ExportSpecifier" ? specifier.local : specifier.imported, false));
      emit(now(importRef({ module, imported })), kindOf(specifier), specifier);
      if (node.type === "ImportDeclaration") top.set(specifier.local.name, kindOf(specifier) === "type" ? null : now(importRef({ module, imported })));
    }
  }

  /** @type {(node: Node, kind: Use["kind"]) => Later | null} */
  const refer = (node, kind) => {
    const chain = /** @type {Node[]} */ ([]);
    let root = node;
    while (WRAPPERS.has(root.type) || root.type === "MemberExpression" || root.type === "JSXMemberExpression") {
      if (!WRAPPERS.has(root.type)) chain.unshift(root);
      root = WRAPPERS.has(root.type) ? root.expression : root.object;
    }
    let ref = /** @type {Later | null} */ (null);
    if (root.type === "Identifier" || root.type === "JSXIdentifier") ref = resolve(root.name);
    else if (root.type === "MetaProperty") ref = root.meta.name === "import" ? now({ space: "global", path: "import.meta" }) : null;
    else walk(root);
    const module = loaded(root);
    if (module !== null) ref = now(importRef({ module, imported: "*" }));
    for (const link of chain) {
      const key = keyOf(link.property, link.computed ?? false);
      if (key === null) walk(link.property);
      else note(key, link.property);
      ref = at(ref, key);
    }
    emit(ref, kind, root);
    return ref;
  };

  /** @type {(node: Node | null, base: Later | null) => void} */
  const pattern = (node, base) => {
    switch (node?.type) {
      case "ObjectPattern":
        for (const prop of node.properties) {
          if (prop.type === "RestElement") {
            pattern(prop.argument, null);
            continue;
          }
          const key = keyOf(prop.key, prop.computed);
          if (key === null) walk(prop.key);
          else note(key, prop.key);
          const ref = at(base, key);
          if ((prop.value.type === "AssignmentPattern" ? prop.value.left : prop.value).type !== "ObjectPattern") emit(ref, "read", prop.key);
          pattern(prop.value, ref);
        }
        return;
      case "AssignmentPattern":
        walk(node.right);
        return pattern(node.left, base);
      case "ArrayPattern": return node.elements.forEach((/** @type {Node | null} */ element, /** @type {number} */ index) => pattern(element, element?.type !== "RestElement" ? at(base, String(index)) : null));
      case "RestElement": return pattern(node.argument, null);
      case "TSParameterProperty": return pattern(node.parameter, null);
      case "Identifier":
        return void stack.findLast((scope) => scope.has(node.name))?.set(node.name, base);
      case undefined: return;
      default: return walk(node);
    }
  };

  /** @type {(node: Node) => void} */
  const visit = (node) => {
    if (FUNCTIONS.has(node.type)) {
      for (const param of node.params) pattern(param, null);
      return walk(node.body);
    }
    if (node.type.endsWith("Pattern") || node.type === "RestElement") return pattern(node, null);
    switch (node.type) {
      case "Identifier":
      case "MemberExpression":
      case "MetaProperty": return void refer(node, "read");
      case "CallExpression": {
        const module = loaded(node);
        if (module !== null) emit(now(moduleRef(module)), "import", node);
        refer(node.callee, "call");
        return walk(node.arguments);
      }
      case "ImportExpression":
        if (typeof node.source.value === "string") emit(now(moduleRef(node.source.value)), "import", node);
        return walk([node.source, node.options]);
      case "ExportNamedDeclaration":
        if (node.source || node.exportKind === "type") return;
        walk(node.declaration);
        for (const specifier of node.specifiers) if (specifier.exportKind !== "type") refer(specifier.local, "read");
        return;
      case "VariableDeclarator": return pattern(node.id, node.init ? refer(node.init, "read") : null);
      case "AssignmentExpression": {
        const base = refer(node.right, "read");
        return node.left.type.endsWith("Pattern") ? pattern(node.left, base) : walk(node.left);
      }
      case "ClassDeclaration":
      case "ClassExpression": return walk([node.decorators, node.superClass, node.body]);
      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty": return walk([node.decorators, node.computed ? node.key : null, node.value]);
      case "LabeledStatement": return walk(node.body);
      case "JSXOpeningElement":
        if (node.name.type === "JSXMemberExpression" || /^[A-Z]/.test(node.name.name ?? "")) refer(node.name, "read");
        return walk(node.attributes);
      case "TSEnumDeclaration": return walk(node.body.members.map((/** @type {Node} */ member) => member.initializer));
      case "TSModuleDeclaration": return walk(node.body?.body);
      default: return walk(Object.values(node));
    }
  };

  /** @type {(node: unknown) => void} */
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    const value = /** @type {Node | null} */ (node);
    if (typeof value?.type !== "string" || value.declare || SKIPPED.has(value.type) || (value.type.startsWith("TS") && !VALUE_TS.has(value.type))) return;
    const bound = scopeNames(value);
    if (bound) stack.push(new Map(bound.map((name) => [name, null])));
    visit(value);
    if (bound) stack.pop();
  };

  stack.push(top);
  walk(program.body);
  const uses = pending.flatMap(({ ref, kind, line }) => {
    const found = ref();
    return found?.path ? [{ space: found.space, path: found.path, kind, line }] : [];
  });
  return { path, uses, members };
}

/**
 * @param {Pick<import("../../repo.mjs").Repo, "files" | "read">} repo
 * @returns {FileFacts[]} One per tracked source outside node_modules, except .d.ts files, which hold no runtime uses.
 */
export function sourceFacts(repo) {
  return repo
    .files()
    .filter((path) => SOURCE.test(path) && !path.endsWith(".d.ts") && !path.split("/").includes("node_modules"))
    .map((path) => factsOf(path, repo.read(path)));
}
