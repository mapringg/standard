import { posix } from "node:path";

import { FILE } from "../config.mjs";
import { dependents, NOT_PRODUCT } from "./support/packages.mjs";
import { reach, reExports, targets } from "./support/reach.mjs";
import { sourceFacts } from "./support/source.mjs";
import { parseSource } from "./support/sources.mjs";

/**
 * @typedef {{ type: string, [key: string]: any }} Node
 *
 * What a name holds where `use` reads it: a parameter of an enclosing function, a local and the expression that set it, or an import.
 * `key` is the property a destructuring pattern took the name from.
 * @typedef {{ kind: "param", fn: Node, index: number, key: string | null } | { kind: "local", init: Node | null, key: string | null, fn?: Node } | { kind: "import", module: string, name: string }} Binding
 *
 * Where a value passed to `use` comes from. `ok` is an exported component's prop, a cached function's result, or a value made once at module
 * level, such as a context. `created` is a
 * call or `new` the render makes. `untraced` is a value whose origin the check cannot read.
 * @typedef {"ok" | "created" | "untraced"} Origin
 */

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression", "ChainExpression"]);
const CREATED = `A new promise on each render suspends forever. Take the promise as a prop from a Server Component, or call a function from a module that cached-modules in ${FILE} lists.`;
const UNTRACED = "The check fails closed here, since a promise made during render suspends forever. Take the promise as a prop, call a function from a module that cached-modules lists, or read a context that createContext makes in a file the check can resolve.";
const SAID = {
  created: { said: "a promise it creates while it renders", fix: CREATED },
  untraced: { said: "a value whose origin the check cannot trace", fix: UNTRACED },
};

/** @type {(node: Node) => Node} */
const unwrap = (node) => (WRAPPERS.has(node.type) ? unwrap(node.expression) : node);

/** @type {(node: Node | null) => string[]} */
function namesOf(node) {
  if (!node) return [];
  switch (node.type) {
    case "Identifier": return [node.name];
    case "ObjectPattern": return node.properties.flatMap((/** @type {Node} */ item) => namesOf(item.type === "RestElement" ? item.argument : item.value));
    case "ArrayPattern": return node.elements.flatMap(namesOf);
    case "AssignmentPattern": return namesOf(node.left);
    case "RestElement": return namesOf(node.argument);
    case "TSParameterProperty": return namesOf(node.parameter);
    default: return [];
  }
}

/** @type {(node: Node) => [string, string | null][]} The names a pattern binds, each with the property it took the name from. */
function keyed(node) {
  if (node.type === "AssignmentPattern") return keyed(node.left);
  if (node.type === "TSParameterProperty") return keyed(node.parameter);
  if (node.type !== "ObjectPattern") return namesOf(node).map((name) => [name, null]);
  return node.properties.flatMap((/** @type {Node} */ item) => {
    const key = item.type === "RestElement" || item.computed ? null : item.key.name ?? String(item.key.value);
    return namesOf(item.type === "RestElement" ? item.argument : item.value).map((name) => [name, key]);
  });
}

/** @type {(object: Node, key: string) => Node} */
const member = (object, key) => ({ type: "MemberExpression", computed: false, object, property: { type: "Identifier", name: key } });

/** @type {(statements: Node[]) => [string, Binding][]} The names a block's own statements declare, each with what it holds. */
function declared(statements) {
  return statements.flatMap((statement) => {
    const node = statement.type.startsWith("Export") && statement.declaration ? statement.declaration : statement;
    if (node.type === "ImportDeclaration" && node.importKind !== "type") {
      return node.specifiers.map((/** @type {Node} */ item) => [item.local.name, { kind: "import", module: node.source.value, name: item.type === "ImportSpecifier" ? item.imported.name ?? item.imported.value : item.type === "ImportDefaultSpecifier" ? "default" : "*" }]);
    }
    if (node.type === "VariableDeclaration") {
      return node.declarations.flatMap((/** @type {Node} */ item) => keyed(item.id).map(([name, key]) => [name, { kind: "local", init: item.init, key }]));
    }
    if (node.type === "FunctionDeclaration" && node.id) return [[node.id.name, { kind: "local", init: null, key: null, fn: node }]];
    return node.type === "ClassDeclaration" && node.id ? [[node.id.name, { kind: "local", init: null, key: null }]] : [];
  });
}

/** @type {(program: Node) => Map<string, Binding>} */
const topLevel = (program) => new Map(declared(program.body));

/** @type {(fn: Node, top: Map<string, Binding>) => boolean} Whether a function returns only a promise it keeps in a module-level binding, so each call after the first returns the same one. */
function keeps(fn, top) {
  /** @type {Set<string>} */
  const own = new Set(fn.params.flatMap(namesOf));
  /** @type {Node[]} */
  const returned = fn.body.type === "BlockStatement" ? [] : [fn.body];
  /** @type {[string, string][]} Each local the function assigns to a name, as [name, local]. */
  const stored = [];
  /** @type {(node: unknown) => void} */
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    const value = /** @type {Node | null} */ (node);
    if (typeof value?.type !== "string" || FUNCTIONS.has(value.type) || value.type === "ClassDeclaration") return;
    if (value.type === "VariableDeclarator") namesOf(value.id).forEach((name) => own.add(name));
    if (value.type === "ReturnStatement") returned.push(value.argument);
    if (value.type === "AssignmentExpression" && value.operator === "=" && value.left.type === "Identifier" && unwrap(value.right).type === "Identifier") stored.push([value.left.name, unwrap(value.right).name]);
    Object.values(value).forEach(walk);
  };
  if (fn.body.type === "BlockStatement") walk(fn.body.body);
  /** @type {(name: string) => boolean} */
  const module = (name) => !own.has(name) && top.get(name)?.kind === "local";
  return returned.length > 0 && returned.every((node) => {
    const value = node && unwrap(node);
    if (value?.type !== "Identifier") return false;
    return module(value.name) || stored.some(([name, local]) => local === value.name && module(name));
  });
}

/** @type {(callee: Node, lookup: (name: string) => Binding | undefined) => boolean} Whether a callee is React's createContext. */
function isCreateContext(callee, lookup) {
  const value = unwrap(callee);
  if (value.type === "Identifier") {
    const binding = lookup(value.name);
    return binding?.kind === "import" && binding.module === "react" && binding.name === "createContext";
  }
  if (value.type !== "MemberExpression" || value.computed || value.property.name !== "createContext" || unwrap(value.object).type !== "Identifier") return false;
  const binding = lookup(unwrap(value.object).name);
  return binding?.kind === "import" && binding.module === "react" && (binding.name === "*" || binding.name === "default");
}

/** @type {(program: Node) => { exported: Set<Node>, trusted: Set<Node> }} Functions a module boundary can call, and those among them that are components, whose props a Server Component may pass. */
function boundary(program) {
  /** @type {Map<string, Node>} */
  const functions = new Map();
  for (const statement of program.body) {
    const node = statement.type.startsWith("Export") && statement.declaration ? statement.declaration : statement;
    if (node.type === "FunctionDeclaration" && node.id) functions.set(node.id.name, node);
    if (node.type === "VariableDeclaration") {
      for (const item of node.declarations) if (item.id.type === "Identifier" && item.init && FUNCTIONS.has(unwrap(item.init).type)) functions.set(item.id.name, unwrap(item.init));
    }
  }
  /** @type {[Node | undefined, string][]} */
  const exports = program.body.flatMap((/** @type {Node} */ statement) => {
    if (statement.type === "ExportDefaultDeclaration") {
      const node = unwrap(statement.declaration);
      return [[node.type === "Identifier" ? functions.get(node.name) : node, "default"]];
    }
    if (statement.type !== "ExportNamedDeclaration" || statement.source) return [];
    const node = statement.declaration;
    if (node?.type === "FunctionDeclaration") return [[node, node.id.name]];
    if (node?.type === "VariableDeclaration") return node.declarations.flatMap((/** @type {Node} */ item) => (item.id.type === "Identifier" ? [[functions.get(item.id.name), item.id.name]] : []));
    return statement.specifiers.map((/** @type {Node} */ item) => [functions.get(item.local.name ?? item.local.value), item.exported.name ?? item.exported.value]);
  });
  const found = exports.flatMap(([fn, name]) => (fn && FUNCTIONS.has(fn.type) ? [{ fn, name }] : []));
  return { exported: new Set(found.map(({ fn }) => fn)), trusted: new Set(found.filter(({ name }) => name === "default" || /^[A-Z]/.test(name)).map(({ fn }) => fn)) };
}

/** @type {(...origins: Origin[]) => Origin} */
const worst = (...origins) => (origins.includes("created") ? "created" : origins.includes("untraced") ? "untraced" : "ok");

/** @type {import("../registry.mjs").Check} */
export default {
  name: "use-promise",
  since: "0.14.15",
  doc: {
    enforces: "In a `\"use client\"` file, React's `use` reads an exported component's prop, a parameter whose callers in the file pass one of these, the result of a function from a module that `cached-modules` lists, or a value made once at module level, such as a context. It never reads a call or `new` that the render makes, through any local. A value whose origin the check cannot trace fails.",
    fix: "Take the promise as a prop from a Server Component, or call a function from a module that `cached-modules` lists.",
    config: ["cached-modules"],
  },
  subject: "tree",
  retired: [],
  applies: (repo) => (dependents(repo, "react").length > 0 ? { on: true } : { on: false, because: "no tracked package.json declares react" }),
  async run(repo) {
    const files = sourceFacts(repo).flatMap((file) => ("error" in file ? [] : [file]));
    const sites = files.filter((file) => file.client && !NOT_PRODUCT.test(file.path)).map((file) => ({
      path: file.path,
      ends: new Set(file.uses.flatMap((use) => (use.kind === "call" && use.space === "module" && use.path === "react#use" ? [use.call.end] : []))),
    })).filter(({ ends }) => ends.size > 0);
    if (sites.length === 0) return [];
    const target = await targets(repo);
    const seeds = files.map((file) => file.path).filter((path) => repo.config.cachedModules.some((glob) => posix.matchesGlob(path, glob)));
    const reached = reach(reExports(files, target), new Map(seeds.map((path) => [path, path])));
    /** @type {(file: string, specifier: string) => string | null} The cached module a specifier reaches, directly or through re-exports. */
    const cached = (file, specifier) => {
      const found = target(file, specifier);
      return found !== null && reached.has(found) ? found : null;
    };
    /** @type {(path: string) => Node | null} */
    const programOf = (path) => {
      const { program, errors } = parseSource(path, repo.read(path), { preserveParens: false });
      return errors.length === 0 ? program : null;
    };
    /** @type {(file: string, binding: Extract<Binding, { kind: "import" }>) => Origin} An import is cached, or a value its module makes once at module level. */
    const imported = (file, { module, name }) => {
      if (cached(file, module) !== null) return "ok";
      const source = target(file, module);
      const program = source === null ? null : programOf(source);
      if (program === null) return "untraced";
      const bindings = topLevel(program);
      const exported = program.body.flatMap((/** @type {Node} */ node) => (node.type === "ExportNamedDeclaration" && !node.source ? node.specifiers : [])).find((/** @type {Node} */ item) => (item.exported.name ?? item.exported.value) === name);
      const binding = bindings.get(exported ? exported.local.name : name);
      return binding?.kind === "local" && binding.init && !FUNCTIONS.has(unwrap(binding.init).type) ? "ok" : "untraced";
    };
    return sites.flatMap(({ path, ends }) => {
      const program = programOf(path);
      if (program === null) return [];
      const text = repo.read(path);
      /** @type {(node: Node) => number} */
      const lineOf = (node) => text.slice(0, node.start).split("\n").length;
      /** @type {Record<Exclude<Origin, "ok">, Set<number>>} */
      const found = { created: new Set(), untraced: new Set() };
      const top = topLevel(program);
      /** @type {Map<string, Binding>[]} */
      const scopes = [top];
      /** @type {(stack: Map<string, Binding>[]) => (name: string) => Binding | undefined} */
      const lookupIn = (stack) => (name) => stack.findLast((scope) => scope.has(name))?.get(name);
      /** @type {{ node: Node, lookup: (name: string) => Binding | undefined }[]} */
      const reads = [];
      /** @type {{ name: string, node: Node, lookup: (name: string) => Binding | undefined }[]} */
      const calls = [];
      /** @type {Set<string>} Names the file reads other than as the callee of a call or the tag of an element. */
      const values = new Set();
      /** @type {Map<Node, string>} */
      const names = new Map();
      /** @type {(node: unknown, parent: Node | null, field: string) => void} */
      const walk = (node, parent, field) => {
        if (Array.isArray(node)) return node.forEach((item) => walk(item, parent, field));
        const value = /** @type {Node | null} */ (node);
        if (typeof value?.type !== "string" || (value.type.startsWith("TS") && !WRAPPERS.has(value.type))) return;
        const lookup = () => lookupIn([...scopes]);
        if (value.type === "FunctionDeclaration" && value.id) names.set(value, value.id.name);
        if (value.type === "VariableDeclarator" && value.id.type === "Identifier" && value.init && FUNCTIONS.has(unwrap(value.init).type)) names.set(unwrap(value.init), value.id.name);
        if (value.type === "Identifier" && !["callee", "id", "key"].includes(field) && !(field === "property" && !parent?.computed)) values.add(value.name);
        const scope = FUNCTIONS.has(value.type)
          ? new Map([
            ...value.params.flatMap((/** @type {Node} */ param, /** @type {number} */ index) => keyed(param).map(([name, key]) => [name, /** @type {Binding} */ ({ kind: "param", fn: value, index, key })])),
            ...(value.body.type === "BlockStatement" ? declared(value.body.body) : []),
          ])
          : value.type === "BlockStatement" ? new Map(declared(value.body)) : null;
        if (scope) scopes.push(/** @type {Map<string, Binding>} */ (scope));
        if (value.type === "CallExpression" && ends.has(value.end) && value.arguments[0]) reads.push({ node: value, lookup: lookup() });
        if (value.type === "CallExpression" && unwrap(value.callee).type === "Identifier") calls.push({ name: unwrap(value.callee).name, node: value, lookup: lookup() });
        if (value.type === "JSXElement" && value.openingElement.name.type === "JSXIdentifier") calls.push({ name: value.openingElement.name.name, node: value, lookup: lookup() });
        Object.entries(value).forEach(([key, child]) => walk(child, value, key));
        if (scope) scopes.pop();
      };
      walk(program.body, null, "body");
      const { exported, trusted } = boundary(program);
      /** @type {Map<string, Origin>} */
      const resolved = new Map();
      /** @type {(fn: Node, index: number, key: string | null) => Origin} A parameter is an exported component's prop, or what each of the file's own calls passes it, and each call that passes a created or untraced value is a finding there. */
      const argument = (fn, index, key) => {
        if (trusted.has(fn)) return "ok";
        const id = `${fn.start}:${index}:${key}`;
        const known = resolved.get(id);
        if (known) return known;
        resolved.set(id, "untraced");
        const name = names.get(fn);
        const at = calls.filter((call) => call.name === name);
        const result = name === undefined || exported.has(fn) || values.has(name) || at.length === 0 ? "untraced" : "ok";
        if (result === "ok") {
          for (const call of at) {
            const verdict = fed(call, index, key);
            if (verdict !== "ok") found[verdict].add(lineOf(call.node));
          }
        }
        resolved.set(id, result);
        return result;
      };
      /** @type {(call: { node: Node, lookup: (name: string) => Binding | undefined }, index: number, key: string | null) => Origin} */
      const fed = ({ node, lookup }, index, key) => {
        /** @type {(value: Node) => Origin} */
        const from = (value) => origin(value, lookup, new Set());
        if (node.type === "JSXElement") {
          if (index > 0) return "untraced";
          return worst(...node.openingElement.attributes.flatMap((/** @type {Node} */ item) => {
            if (item.type === "JSXSpreadAttribute") return [from(item.argument)];
            if (key !== null && item.name.name !== key) return [];
            return [item.value?.type === "JSXExpressionContainer" && item.value.expression.type !== "JSXEmptyExpression" ? from(item.value.expression) : "ok"];
          }), ...((key === null || key === "children") && node.children.some((/** @type {Node} */ child) => child.type !== "JSXText") ? [/** @type {Origin} */ ("untraced")] : []));
        }
        if (node.arguments.slice(0, index + 1).some((/** @type {Node} */ item) => item.type === "SpreadElement")) return "untraced";
        const value = node.arguments[index];
        if (!value) return "ok";
        if (key === null) return from(value);
        const object = unwrap(value);
        if (object.type !== "ObjectExpression") return from(member(value, key));
        return worst(...object.properties.flatMap((/** @type {Node} */ item) => {
          if (item.type === "SpreadElement") return [from(item.argument)];
          return !item.computed && (item.key.name ?? String(item.key.value)) === key ? [from(item.value)] : [];
        }));
      };
      /** @type {(node: Node, lookup: (name: string) => Binding | undefined, seen: Set<Node>) => Origin} */
      const origin = (node, lookup, seen) => {
        const value = unwrap(node);
        if (seen.has(value)) return "untraced";
        seen.add(value);
        switch (value.type) {
          case "ConditionalExpression": return worst(origin(value.consequent, lookup, seen), origin(value.alternate, lookup, seen));
          case "LogicalExpression": return worst(origin(value.left, lookup, seen), origin(value.right, lookup, seen));
          case "MemberExpression": {
            const object = unwrap(value.object);
            const binding = !value.computed && object.type === "Identifier" ? lookup(object.name) : undefined;
            return binding?.kind === "param" && binding.key === null ? argument(binding.fn, binding.index, value.property.name) : origin(value.object, lookup, seen);
          }
          case "NewExpression": return "created";
          case "CallExpression": {
            if (isCreateContext(value.callee, lookup)) return "ok";
            let callee = unwrap(value.callee);
            while (callee.type === "MemberExpression") callee = unwrap(callee.object);
            const binding = callee.type === "Identifier" ? lookup(callee.name) : undefined;
            if (binding?.kind === "import") return cached(path, binding.module) !== null ? "ok" : "created";
            const fn = binding?.kind === "local" && binding === top.get(callee.name) ? binding.fn ?? (binding.init && unwrap(binding.init)) : null;
            return callee === unwrap(value.callee) && fn && FUNCTIONS.has(fn.type) && keeps(fn, top) ? "ok" : "created";
          }
          case "Identifier": {
            const binding = lookup(value.name);
            if (binding?.kind === "param") return argument(binding.fn, binding.index, binding.key);
            if (binding?.kind === "import") return imported(path, binding);
            if (binding?.kind !== "local" || !binding.init) return "untraced";
            if (binding === top.get(value.name)) return FUNCTIONS.has(unwrap(binding.init).type) ? "untraced" : "ok";
            return origin(binding.key === null ? binding.init : member(binding.init, binding.key), lookup, seen);
          }
          default: return "untraced";
        }
      };
      for (const { node, lookup } of reads) {
        const verdict = origin(node.arguments[0], lookup, new Set());
        if (verdict !== "ok") found[verdict].add(lineOf(node));
      }
      return /** @type {const} */ (["created", "untraced"]).flatMap((verdict) => {
        const lines = [...found[verdict]].sort((a, b) => a - b);
        if (lines.length === 0) return [];
        return [{ key: `${path} use ${verdict}`, fix: `${path} passes React's use() ${SAID[verdict].said}, on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}. ${SAID[verdict].fix}` }];
      });
    });
  },
};
