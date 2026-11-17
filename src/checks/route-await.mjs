import { posix } from "node:path";

import { dependents, NOT_PRODUCT } from "./support/packages.mjs";
import { parseSource, sourceFiles } from "./support/sources.mjs";

/** @typedef {{ type: string, [key: string]: any }} Node */

const ROUTE = "**/app/**/{page,layout}.{js,jsx,ts,tsx}";
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression"]);
/** The props Next 16 passes a page or layout as promises, which only say which route rendered. */
const ROUTE_PROPS = new Set(["params", "searchParams"]);
const FIX = "Move the read into a small async component that awaits it inside <Suspense>, or start the request without await and pass the promise down.";

/** @type {(node: Node) => Node} */
const unwrap = (node) => (WRAPPERS.has(node.type) ? unwrap(node.expression) : node);

/** @type {(key: Node, computed: boolean) => string | null} */
const keyOf = (key, computed) => (!computed && key.type === "Identifier" ? key.name : key.type === "Literal" && typeof key.value === "string" ? key.value : null);

/** @type {(program: Node) => Node | null} The function a route's default export names: declared in the export, or a top-level function or const it refers to. */
function defaultExport(program) {
  /** @type {Map<string, Node>} */
  const functions = new Map();
  let exported = /** @type {Node | null} */ (null);
  for (const node of program.body) {
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type === "FunctionDeclaration" && declaration.id) functions.set(declaration.id.name, declaration);
    if (declaration?.type === "VariableDeclaration") {
      for (const item of declaration.declarations) if (item.id.type === "Identifier" && item.init && FUNCTIONS.has(unwrap(item.init).type)) functions.set(item.id.name, unwrap(item.init));
    }
    if (node.type === "ExportDefaultDeclaration") exported = unwrap(node.declaration);
    if (node.type === "ExportNamedDeclaration" && !node.source) {
      const specifier = node.specifiers.find((/** @type {Node} */ item) => keyOf(item.exported, false) === "default");
      if (specifier) exported = specifier.local;
    }
  }
  if (exported === null) return null;
  if (FUNCTIONS.has(exported.type)) return exported;
  return exported.type === "Identifier" ? functions.get(exported.name) ?? null : null;
}

/** @type {(component: Node) => Node[]} Each await in the component's own body whose value is not a route prop, through any local that holds one. */
function dataAwaits(component) {
  const routeNames = /** @type {Set<string>} */ (new Set());
  let props = /** @type {string | null} */ (null);
  /** @type {(pattern: Node) => void} */
  const bindRouteProps = (pattern) => {
    for (const property of pattern.properties) {
      if (property.type !== "Property" || !ROUTE_PROPS.has(keyOf(property.key, property.computed) ?? "")) continue;
      const value = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
      if (value.type === "Identifier") routeNames.add(value.name);
    }
  };
  const first = component.params[0]?.type === "AssignmentPattern" ? component.params[0].left : component.params[0];
  if (first?.type === "ObjectPattern") bindRouteProps(first);
  if (first?.type === "Identifier") props = first.name;
  /** @type {(node: Node) => boolean} */
  const routeProp = (node) => {
    const value = unwrap(node);
    if (value.type === "Identifier") return routeNames.has(value.name);
    return value.type === "MemberExpression" && unwrap(value.object).type === "Identifier" && unwrap(value.object).name === props && ROUTE_PROPS.has(keyOf(value.property, value.computed) ?? "");
  };
  const found = /** @type {Node[]} */ ([]);
  /** @type {(node: unknown) => void} */
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    const value = /** @type {Node | null} */ (node);
    if (typeof value?.type !== "string" || FUNCTIONS.has(value.type) || (value.type.startsWith("TS") && !WRAPPERS.has(value.type))) return;
    if (value.type === "VariableDeclarator" && value.init) {
      if (value.id.type === "Identifier" && routeProp(value.init)) routeNames.add(value.id.name);
      if (value.id.type === "ObjectPattern" && unwrap(value.init).type === "Identifier" && unwrap(value.init).name === props) bindRouteProps(value.id);
    }
    if (value.type === "AwaitExpression" && !routeProp(value.argument)) found.push(value);
    Object.values(value).forEach(walk);
  };
  walk(component.body);
  return found;
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "route-await",
  since: "0.14.14",
  doc: {
    enforces: "The default export of a Next `app/**/page.*` or `app/**/layout.*` awaits nothing but its `params` and `searchParams` props, through any local or destructuring that holds them. Awaits inside nested functions, other exports such as `generateMetadata`, and tests are not counted.",
    fix: "Move the read into a small async component that awaits it inside `<Suspense>`, or start the request without `await` and pass the promise down.",
    config: [],
  },
  subject: "tree",
  retired: [],
  applies: (repo) => (dependents(repo, "next").length > 0 ? { on: true } : { on: false, because: "no tracked package.json declares next" }),
  run(repo) {
    const apps = dependents(repo, "next");
    const routes = sourceFiles(repo).filter((path) => posix.matchesGlob(path, ROUTE) && !NOT_PRODUCT.test(path) && apps.some((app) => app === "." || path.startsWith(`${app}/`)));
    return routes.flatMap((path) => {
      const text = repo.read(path);
      const { program, errors } = parseSource(path, text);
      const component = errors.length === 0 ? defaultExport(program) : null;
      if (component === null) return [];
      const lines = dataAwaits(component).map((node) => text.slice(0, node.start).split("\n").length);
      const shown = `line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}`;
      return lines.map(() => ({ key: `${path} await`, fix: `${path}: its default export awaits data on ${shown}, so the route renders nothing until it arrives. ${FIX}` }));
    });
  },
};
