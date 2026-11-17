import { GLOBAL_OBJECTS } from "../../config.mjs";
import { namesOf as names } from "../boundaries.mjs";
import { parseSource, sourceFiles } from "./sources.mjs";

/**
 * @typedef {{ type: string, [key: string]: any }} Node
 *
 * One use of an API from outside the file. A "module" path is a specifier, or `specifier#export` and any static members read after it, such as `react#useMemo` or `vitest#vi.mock`.
 * A "global" path is a dotted chain from an unshadowed global, such as `process.env.API_URL`. Kind "type" is a type-only import, which no rule counts.
 * A call adds `call`: the name and start offset of the nearest named function around it, the first name its result's
 * array pattern binds, and the UTF-16 offset where the call ends.
 * Kind "bind" is a read whose value a local, a destructuring pattern or an export takes, so the walk follows it there. A "read" goes where
 * the walk cannot follow, such as an argument, an object or a key only runtime knows, which reads the object before that key.
 * @typedef {{ owner: { name: string, at: number } | null, first: string | null, end: number }} Call
 * @typedef {{ space: "module" | "global", path: string, kind: "import" | "type" | "read" | "bind", line: number } | { space: "module" | "global", path: string, kind: "call", line: number, call: Call }} Use
 *
 * `members` holds the lines of each static property name read on any object, by member access or destructuring.
 * `client` is true when the directive prologue holds "use client".
 * `exports` holds each value the file exports that comes from outside it: `vitest#vi` for `export { vi } from "vitest"` or a local that holds vi, and the module itself for `export * from "vitest"`.
 * @typedef {{ space: "module" | "global", path: string, line: number }} Export
 * @typedef {{ path: string, uses: readonly Use[], exports: readonly Export[], members: ReadonlyMap<string, readonly number[]>, client: boolean }} Parsed
 * @typedef {Parsed | { path: string, error: string }} FileFacts
 *
 * What a chain names so far, and what a binding holds: an import, a local that a static chain initialized, or a const that holds a constant
 * string or number. Other locals hold null. A module ref with a `namespace` is a namespace or default binding, whose next key names an export.
 * @typedef {{ space: "global", path: string } | { space: "module", path: string, namespace: string | null } | { space: "value", value: string | number }} Ref
 *
 * A ref read once the whole file is walked, so a function may use a local declared below it. A cycle reads as null.
 * @typedef {() => Ref | null} Later
 */

/** Modules whose default or namespace binding is a global, and whose named exports are its members. */
const MODULE_GLOBALS = new Map([["process", "process"], ["node:process", "process"]]);

/** Globals that hold a module's namespace: an in-source Vitest test reads vi from import.meta.vitest. */
const GLOBAL_MODULES = new Map([["import.meta.vitest", "vitest"]]);

const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ChainExpression"]);

/** TypeScript nodes that hold a value expression. Every other TS node is a type, and the walk skips it. */
const VALUE_TS = new Set([...WRAPPERS, "TSInstantiationExpression", "TSEnumDeclaration", "TSExportAssignment", "TSModuleDeclaration"]);

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Nodes that hold no reference: imports, read once up front, labels, and a closing tag that repeats its opening tag. */
const SKIPPED = new Set(["ImportDeclaration", "ExportAllDeclaration", "BreakStatement", "ContinueStatement", "JSXClosingElement"]);

/** @type {(value: string | number | null) => Ref | null} */
const valueRef = (value) => (value === null ? null : { space: "value", value });

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

/** @typedef {() => string | null} Key A property name, read once the whole file is walked. */

/** @type {(ref: Later | null, key: Key) => Later | null} */
const at = (ref, key) => ref && later(() => {
  const base = ref();
  const name = key();
  return base && name !== null ? extend(base, name) : null;
});

/** @type {(ref: Later | null, key: Key) => Later | null} The object before a key only runtime knows, which the code reads whole. */
const unknown = (ref, key) => ref && later(() => (key() === null ? ref() : null));

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

/** @type {(ref: Ref, key: string) => Ref | null} A module namespace's default reads as the default binding, as interop makes it. */
function extend(ref, key) {
  if (ref.space === "value") return null;
  if (ref.space === "global") {
    const path = ref.path ? `${ref.path}.${key}` : key;
    const module = GLOBAL_MODULES.get(path);
    return module ? importRef({ module, imported: "*" }) : { space: "global", path };
  }
  if (ref.namespace === null) return moduleRef(`${ref.path}.${key}`);
  return key === "default" ? { space: "module", path: `${ref.namespace}#default`, namespace: ref.namespace } : moduleRef(`${ref.namespace}#${key}`);
}

/** @type {(binding: { module: string, imported: string }) => Ref} */
function importRef({ module, imported }) {
  const global = MODULE_GLOBALS.get(module);
  const whole = imported === "*" || imported === "default";
  if (global) return whole ? { space: "global", path: global } : { space: "global", path: `${global}.${imported}` };
  return whole ? { space: "module", path: imported === "*" ? module : `${module}#default`, namespace: module } : moduleRef(`${module}#${imported}`);
}

/** @type {(path: string, text: string) => FileFacts} */
function factsOf(path, text) {
  const { program, errors } = parseSource(path, text, { preserveParens: false });
  if (errors.length > 0) return { path, error: errors[0].message };
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  const lineOf = (/** @type {Node} */ node) => starts.findLastIndex((start) => start <= node.start) + 1;
  const pending = /** @type {{ ref: Later, kind: Use["kind"], line: number, call?: Call }[]} */ ([]);
  const exported = /** @type {{ ref: Later, line: number }[]} */ ([]);
  const members = /** @type {Map<string, number[]>} */ (new Map());
  const stack = /** @type {Map<string, Later | null>[]} */ ([]);
  const owners = /** @type {{ name: string, at: number }[]} */ ([]);
  const labels = /** @type {Map<Node, string>} */ (new Map());
  const firsts = /** @type {Map<Node, string>} */ (new Map());

  /** @type {(ref: Later | null, kind: Use["kind"], node: Node, call?: Call) => void} */
  const emit = (ref, kind, node, call) => {
    if (ref) pending.push({ ref, kind, line: lineOf(node), call });
  };
  /** @type {(ref: Later | null, node: Node) => void} */
  const exportOf = (ref, node) => {
    if (ref) exported.push({ ref, line: lineOf(node) });
  };
  /** @type {(node: Node | null, name: string) => void} Names the functions a binding holds, through wrapping calls such as memo(...). */
  const label = (node, name) => {
    if (!node) return;
    if (FUNCTIONS.has(node.type)) labels.set(node, name);
    else if (WRAPPERS.has(node.type)) label(node.expression, name);
    else if (node.type === "CallExpression") node.arguments.forEach((/** @type {Node} */ arg) => label(arg, name));
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
  /** @type {(node: Node) => () => string | number | null} The string or number an expression always has: a literal, a template or a sum of them, or a const that holds one. */
  const constant = (node) => {
    if (WRAPPERS.has(node.type)) return constant(node.expression);
    if (node.type === "Literal") return () => (typeof node.value === "string" || typeof node.value === "number" ? node.value : null);
    if (node.type === "Identifier") {
      const ref = resolve(node.name);
      return () => {
        const found = ref();
        return found?.space === "value" ? found.value : null;
      };
    }
    if (node.type === "TemplateLiteral") {
      const parts = /** @type {(() => string | number | null)[]} */ (node.expressions.map(constant));
      return () => {
        const values = parts.map((part) => part());
        return values.includes(null) ? null : node.quasis.map((/** @type {Node} */ quasi, /** @type {number} */ index) => quasi.value.cooked + (index < values.length ? String(values[index]) : "")).join("");
      };
    }
    if (node.type === "BinaryExpression" && node.operator === "+") {
      const [left, right] = [constant(node.left), constant(node.right)];
      return () => {
        const [a, b] = [left(), right()];
        return a === null || b === null ? null : /** @type {string} */ (a) + /** @type {string} */ (b);
      };
    }
    return () => null;
  };
  /** @type {(node: Node) => Key} */
  const keyAt = (node) => {
    const value = constant(node);
    return () => {
      const found = value();
      return found === null ? null : String(found);
    };
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
    if (node.type === "ExportAllDeclaration" && !typeOnly) exportOf(now(importRef({ module, imported: "*" })), node);
    for (const specifier of specifiers) {
      const imported = specifier.type === "ImportDefaultSpecifier" ? "default" : specifier.type === "ImportNamespaceSpecifier" ? "*"
        : /** @type {string} */ (keyOf(specifier.type === "ExportSpecifier" ? specifier.local : specifier.imported, false));
      emit(now(importRef({ module, imported })), kindOf(specifier), specifier);
      if (node.type === "ExportNamedDeclaration" && kindOf(specifier) !== "type") exportOf(now(importRef({ module, imported })), specifier);
      if (node.type === "ImportDeclaration") top.set(specifier.local.name, kindOf(specifier) === "type" ? null : now(importRef({ module, imported })));
    }
  }

  /** @type {(node: Node, kind: Use["kind"], call?: Call) => Later | null} */
  const refer = (node, kind, call) => {
    const chain = /** @type {Node[]} */ ([]);
    let root = node;
    while (WRAPPERS.has(root.type) || root.type === "MemberExpression" || root.type === "JSXMemberExpression") {
      if (!WRAPPERS.has(root.type)) chain.unshift(root);
      root = WRAPPERS.has(root.type) ? root.expression : root.object;
    }
    let ref = /** @type {Later | null} */ (null);
    const module = loaded(root);
    if (module !== null) {
      emit(now(moduleRef(module)), "import", root);
      if (root.type === "CallExpression") refer(root.callee, "call", { owner: owners.at(-1) ?? null, first: firsts.get(root) ?? null, end: root.end });
      ref = now(importRef({ module, imported: "*" }));
    } else if (root.type === "Identifier" || root.type === "JSXIdentifier") ref = resolve(root.name);
    else if (root.type === "MetaProperty") ref = root.meta.name === "import" ? now({ space: "global", path: "import.meta" }) : null;
    else walk(root);
    for (const link of chain) {
      const name = keyOf(link.property, link.computed ?? false);
      if (name !== null) {
        note(name, link.property);
        ref = at(ref, () => name);
        continue;
      }
      walk(link.property);
      const key = keyAt(link.property);
      emit(unknown(ref, key), "read", link.property);
      ref = at(ref, key);
    }
    emit(ref, kind, root, call);
    return ref;
  };

  /** @type {(node: Node | null, base: Later | null) => void} */
  const pattern = (node, base) => {
    switch (node?.type) {
      case "ObjectPattern":
        for (const prop of node.properties) {
          if (prop.type === "RestElement") {
            emit(base, "read", prop);
            pattern(prop.argument, null);
            continue;
          }
          const name = keyOf(prop.key, prop.computed);
          if (name !== null) note(name, prop.key);
          else walk(prop.key);
          const key = name === null ? keyAt(prop.key) : () => name;
          if (name === null) emit(unknown(base, key), "read", prop.key);
          const ref = at(base, key);
          if ((prop.value.type === "AssignmentPattern" ? prop.value.left : prop.value).type !== "ObjectPattern") emit(ref, "read", prop.key);
          pattern(prop.value, ref);
        }
        return;
      case "AssignmentPattern":
        walk(node.right);
        return pattern(node.left, base);
      case "ArrayPattern": return node.elements.forEach((/** @type {Node | null} */ element, /** @type {number} */ index) => pattern(element, element?.type !== "RestElement" ? at(base, () => String(index)) : null));
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
      const name = node.id?.name ?? labels.get(node);
      if (name) owners.push({ name, at: node.start });
      for (const param of node.params) pattern(param, null);
      walk(node.body);
      if (name) owners.pop();
      return;
    }
    if (node.type.endsWith("Pattern") || node.type === "RestElement") return pattern(node, null);
    switch (node.type) {
      case "Identifier":
      case "MemberExpression":
      case "MetaProperty": return void refer(node, "read");
      case "AwaitExpression": return loaded(node) === null ? walk(node.argument) : void refer(node, "read");
      case "CallExpression": {
        if (loaded(node) !== null) return void refer(node, "read");
        refer(node.callee, "call", { owner: owners.at(-1) ?? null, first: firsts.get(node) ?? null, end: node.end });
        return walk(node.arguments);
      }
      case "ImportExpression":
        if (typeof node.source.value === "string") {
          emit(now(moduleRef(node.source.value)), "import", node);
          emit(now(importRef({ module: node.source.value, imported: "*" })), "read", node);
        }
        return walk([node.source, node.options]);
      case "ExportNamedDeclaration":
        if (node.source || node.exportKind === "type") return;
        walk(node.declaration);
        for (const name of node.declaration ? declared([node.declaration]) : []) exportOf(resolve(name), node);
        for (const specifier of node.specifiers) if (specifier.exportKind !== "type") exportOf(refer(specifier.local, "bind"), specifier);
        return;
      case "VariableDeclaration": return node.declarations.forEach((/** @type {Node} */ item) => declare(item, node.kind === "const"));
      case "ExportDefaultDeclaration":
        label(node.declaration, "default");
        return exportOf(refer(node.declaration, "bind"), node);
      case "AssignmentExpression": {
        const base = refer(node.right, node.left.type.endsWith("Pattern") ? "bind" : "read");
        return node.left.type.endsWith("Pattern") ? pattern(node.left, base) : walk(node.left);
      }
      case "ClassDeclaration":
      case "ClassExpression": return walk([node.decorators, node.superClass, node.body]);
      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty": {
        const key = keyOf(node.key, node.computed);
        if (key !== null) label(node.value, key);
        return walk([node.decorators, node.computed ? node.key : null, node.value]);
      }
      case "LabeledStatement": return walk(node.body);
      case "JSXOpeningElement":
        if (node.name.type === "JSXMemberExpression" || /^[A-Z]/.test(node.name.name ?? "")) refer(node.name, "read");
        return walk(node.attributes);
      case "TSEnumDeclaration": return walk(node.body.members.map((/** @type {Node} */ member) => member.initializer));
      case "TSModuleDeclaration": return walk(node.body?.body);
      default: return walk(Object.values(node));
    }
  };

  /** @type {(node: Node, fixed: boolean) => void} A const binds its constant value, so a computed key can read it. */
  const declare = (node, fixed) => {
    if (node.id.type === "Identifier") label(node.init, node.id.name);
    const first = node.id.type === "ArrayPattern" ? node.id.elements[0] : null;
    if (first?.type === "Identifier" && node.init) firsts.set(node.init, first.name);
    const ref = node.init ? refer(node.init, "bind") : null;
    const value = fixed && node.init && node.id.type === "Identifier" ? constant(node.init) : null;
    pattern(node.id, value ? later(() => ref?.() ?? valueRef(value())) : ref);
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
  const exports = exported.flatMap(({ ref, line }) => {
    const found = ref();
    return found && found.space !== "value" && found.path ? [{ space: found.space, path: found.path, line }] : [];
  });
  const uses = pending.flatMap(({ ref, kind, line, call }) => {
    const found = ref();
    if (!found || found.space === "value" || !found.path) return [];
    const use = { space: found.space, path: found.path, line };
    return [call ? { ...use, kind: /** @type {const} */ ("call"), call } : { ...use, kind: /** @type {Exclude<Use["kind"], "call">} */ (kind) }];
  });
  return { path, uses, exports, members, client: program.body.some((/** @type {Node} */ node) => node.directive === "use client") };
}

/** banned and react read the same repo in one run, so each parses it once. */
const parsed = /** @type {WeakMap<object, FileFacts[]>} */ (new WeakMap());

/**
 * @param {Pick<import("../../repo.mjs").Repo, "files" | "read">} repo
 * @returns {FileFacts[]} One per tracked source outside node_modules, except .d.ts files, which hold no runtime uses.
 */
export function sourceFacts(repo) {
  const cached = parsed.get(repo);
  if (cached) return cached;
  const facts = sourceFiles(repo)
    .filter((path) => !path.endsWith(".d.ts"))
    .map((path) => factsOf(path, repo.read(path)));
  parsed.set(repo, facts);
  return facts;
}
