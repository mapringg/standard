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
 * @typedef {{ kind: "param" } | { kind: "local", init: Node | null } | { kind: "import", module: string, name: string }} Binding
 *
 * Where a value passed to `use` comes from. `ok` is a prop, a parameter, a cached function's result or a context. `created` is a call or
 * `new` the render makes. `untraced` is a value whose origin the check cannot read.
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

/** @type {(statements: Node[]) => [string, Binding][]} The names a block's own statements declare, each with what it holds. */
function declared(statements) {
  return statements.flatMap((statement) => {
    const node = statement.type.startsWith("Export") && statement.declaration ? statement.declaration : statement;
    if (node.type === "ImportDeclaration" && node.importKind !== "type") {
      return node.specifiers.map((/** @type {Node} */ item) => [item.local.name, { kind: "import", module: node.source.value, name: item.type === "ImportSpecifier" ? item.imported.name ?? item.imported.value : item.type === "ImportDefaultSpecifier" ? "default" : "*" }]);
    }
    if (node.type === "VariableDeclaration") {
      return node.declarations.flatMap((/** @type {Node} */ item) => namesOf(item.id).map((name) => [name, { kind: "local", init: item.init }]));
    }
    return ["FunctionDeclaration", "ClassDeclaration"].includes(node.type) && node.id ? [[node.id.name, { kind: "local", init: null }]] : [];
  });
}

/** @type {(program: Node) => Map<string, Binding>} */
const topLevel = (program) => new Map(declared(program.body));

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

/** @type {(...origins: Origin[]) => Origin} */
const worst = (...origins) => (origins.includes("created") ? "created" : origins.includes("untraced") ? "untraced" : "ok");

/** @type {import("../registry.mjs").Check} */
export default {
  name: "use-promise",
  since: "0.14.15",
  doc: {
    enforces: "In a `\"use client\"` file, React's `use` reads a prop, a parameter, the result of a function from a module that `cached-modules` lists, or a context that `createContext` makes. It never reads a call or `new` that the render makes, through any local. A value whose origin the check cannot trace fails.",
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
    /** @type {(file: string, binding: Extract<Binding, { kind: "import" }>) => Origin} An import is cached, or a context its module makes with createContext. */
    const imported = (file, { module, name }) => {
      if (cached(file, module) !== null) return "ok";
      const source = target(file, module);
      const program = source === null ? null : programOf(source);
      if (program === null) return "untraced";
      const bindings = topLevel(program);
      const exported = program.body.flatMap((/** @type {Node} */ node) => (node.type === "ExportNamedDeclaration" && !node.source ? node.specifiers : [])).find((/** @type {Node} */ item) => (item.exported.name ?? item.exported.value) === name);
      const binding = bindings.get(exported ? exported.local.name : name);
      const init = binding?.kind === "local" && binding.init ? unwrap(binding.init) : null;
      return init?.type === "CallExpression" && isCreateContext(init.callee, (local) => bindings.get(local)) ? "ok" : "untraced";
    };
    return sites.flatMap(({ path, ends }) => {
      const program = programOf(path);
      if (program === null) return [];
      const text = repo.read(path);
      /** @type {{ origin: Exclude<Origin, "ok">, line: number }[]} */
      const found = [];
      /** @type {Map<string, Binding>[]} */
      const scopes = [topLevel(program)];
      /** @type {(stack: Map<string, Binding>[]) => (name: string) => Binding | undefined} */
      const lookupIn = (stack) => (name) => stack.findLast((scope) => scope.has(name))?.get(name);
      /** @type {(node: Node, lookup: (name: string) => Binding | undefined, seen: Set<Node>) => Origin} */
      const origin = (node, lookup, seen) => {
        const value = unwrap(node);
        if (seen.has(value)) return "untraced";
        seen.add(value);
        switch (value.type) {
          case "ConditionalExpression": return worst(origin(value.consequent, lookup, seen), origin(value.alternate, lookup, seen));
          case "LogicalExpression": return worst(origin(value.left, lookup, seen), origin(value.right, lookup, seen));
          case "MemberExpression": return origin(value.object, lookup, seen);
          case "NewExpression": return "created";
          case "CallExpression": {
            if (isCreateContext(value.callee, lookup)) return "ok";
            let callee = unwrap(value.callee);
            while (callee.type === "MemberExpression") callee = unwrap(callee.object);
            const binding = callee.type === "Identifier" ? lookup(callee.name) : undefined;
            return binding?.kind === "import" && cached(path, binding.module) !== null ? "ok" : "created";
          }
          case "Identifier": {
            const binding = lookup(value.name);
            if (binding?.kind === "param") return "ok";
            if (binding?.kind === "import") return imported(path, binding);
            return binding?.kind === "local" && binding.init ? origin(binding.init, lookup, seen) : "untraced";
          }
          default: return "untraced";
        }
      };
      /** @type {(node: unknown) => void} */
      const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        const value = /** @type {Node | null} */ (node);
        if (typeof value?.type !== "string" || (value.type.startsWith("TS") && !WRAPPERS.has(value.type))) return;
        const scope = FUNCTIONS.has(value.type) ? new Map([...value.params.flatMap(namesOf).map((/** @type {string} */ name) => [name, /** @type {Binding} */ ({ kind: "param" })]), ...(value.body.type === "BlockStatement" ? declared(value.body.body) : [])])
          : value.type === "BlockStatement" ? new Map(declared(value.body)) : null;
        if (scope) scopes.push(/** @type {Map<string, Binding>} */ (scope));
        if (value.type === "CallExpression" && ends.has(value.end) && value.arguments[0]) {
          const verdict = origin(value.arguments[0], lookupIn([...scopes]), new Set());
          if (verdict !== "ok") found.push({ origin: verdict, line: text.slice(0, value.start).split("\n").length });
        }
        Object.values(value).forEach(walk);
        if (scope) scopes.pop();
      };
      walk(program.body);
      return found.map(({ origin: verdict }) => {
        const lines = found.filter((item) => item.origin === verdict).map((item) => item.line);
        return { key: `${path} use ${verdict}`, fix: `${path} passes React's use() ${SAID[verdict].said}, on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}. ${SAID[verdict].fix}` };
      });
    });
  },
};
