import { createHash } from "node:crypto";

import { parseSync } from "oxc-parser";

/**
 * @typedef {{ type: string, [key: string]: any }} Node
 * @typedef {{ names: Set<string> }} Scope
 * @typedef {{ file: string, start: number, end: number, line: number, nodes: number, fingerprint: string, path: string }} Candidate
 */

const MIN_NODES = 8;
const SCANNED = /\.tsx?$/;
const SKIPPED = /\.d\.ts$|\.(test|spec|stories)\.[^/]+$|(^|\/)(__tests__|tests?)\//;
const SKIPPED_KEYS = new Set([
  "start",
  "end",
  "range",
  "loc",
  "raw",
  "decorators",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "accessibility",
  "declare",
  "definite",
  "override",
  "readonly",
  "directive",
  "phase",
  "importKind",
  "exportKind",
]);
const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const SCOPES = new Set([
  ...FUNCTIONS,
  "BlockStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "CatchClause",
  "SwitchStatement",
  "StaticBlock",
]);
const FLAGS = ["operator", "kind", "computed", "async", "generator", "delegate", "static"];
const NAMED_BY_KEY = new Set(["Property", "MethodDefinition", "PropertyDefinition", "TSPropertySignature"]);
const NAMED = new Set(["LabeledStatement", "BreakStatement", "ContinueStatement", "ImportSpecifier", "ExportSpecifier"]);

/**
 * @param {unknown} value
 * @returns {value is Node}
 */
function isNode(value) {
  return value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";
}

/**
 * @param {Node | null | undefined} pattern
 * @param {string[]} out
 */
function patternNames(pattern, out) {
  switch (pattern?.type) {
    case "Identifier":
      out.push(pattern.name);
      break;
    case "AssignmentPattern":
      patternNames(pattern.left, out);
      break;
    case "RestElement":
      patternNames(pattern.argument, out);
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) patternNames(element, out);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        patternNames(property.type === "RestElement" ? property.argument : property.value, out);
      }
      break;
    case "TSParameterProperty":
      patternNames(pattern.parameter, out);
  }
}

/**
 * @param {Node} declaration
 * @param {string[]} out
 */
function declaratorNames(declaration, out) {
  for (const declarator of declaration.declarations) patternNames(declarator.id, out);
}

/**
 * @param {unknown} node
 * @param {string[]} out
 */
function hoistedVars(node, out) {
  if (!isNode(node) || FUNCTIONS.has(node.type)) return;
  if (node.type === "VariableDeclaration" && node.kind === "var") declaratorNames(node, out);
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (Array.isArray(value)) for (const item of value) hoistedVars(item, out);
    else hoistedVars(value, out);
  }
}

/**
 * @param {Node} scope
 * @returns {Scope}
 */
function declaredBy(scope) {
  /** @type {string[]} */
  const names = [];
  if (FUNCTIONS.has(scope.type)) {
    for (const param of scope.params) patternNames(param, names);
    hoistedVars(scope.body, names);
  }
  /** @type {Node[]} */
  const statements =
    scope.type === "BlockStatement" || scope.type === "StaticBlock"
      ? scope.body
      : scope.type === "SwitchStatement"
        ? scope.cases.flatMap((/** @type {Node} */ entry) => entry.consequent)
        : [];
  for (const statement of statements) {
    if (statement.type === "VariableDeclaration" && statement.kind !== "var") declaratorNames(statement, names);
    else if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) {
      names.push(statement.id.name);
    }
  }
  if (scope.type === "ForStatement" && scope.init?.type === "VariableDeclaration") declaratorNames(scope.init, names);
  if ((scope.type === "ForInStatement" || scope.type === "ForOfStatement") && scope.left.type === "VariableDeclaration") {
    declaratorNames(scope.left, names);
  }
  if (scope.type === "CatchClause") patternNames(scope.param, names);
  return { names: new Set(names) };
}

/**
 * @param {Node | null} parent
 * @param {string | null} key
 * @returns {boolean} Whether an identifier here is a fixed name, such as a property, and not a reference to rename.
 */
function isName(parent, key) {
  if (!parent) return false;
  if (key === "property" && parent.type === "MemberExpression" && !parent.computed) return true;
  if (key === "key" && !parent.computed && NAMED_BY_KEY.has(parent.type)) return true;
  return NAMED.has(parent.type);
}

/**
 * @param {Node} unit
 * @returns {{ nodes: number, text: string }}
 */
function normalizeUnit(unit) {
  /** @type {string[]} */
  const tokens = [];
  /** @type {Map<string, string>} */
  const symbols = new Map();
  /** @type {Map<Scope, number>} */
  const scopeIds = new Map();
  let count = 0;
  let counting = false;

  const symbolFor = (/** @type {Scope} */ scope, /** @type {string} */ name) => {
    if (!scopeIds.has(scope)) scopeIds.set(scope, scopeIds.size);
    const key = `${scopeIds.get(scope)}:${name}`;
    if (!symbols.has(key)) symbols.set(key, `$${symbols.size}`);
    return /** @type {string} */ (symbols.get(key));
  };

  /**
   * @param {unknown} node
   * @param {Node | null} parent
   * @param {string | null} key
   * @param {Scope[]} scopes
   */
  const visit = (node, parent, key, scopes) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent, key, scopes);
      return;
    }
    if (!isNode(node)) return;
    if (TYPE_WRAPPERS.has(node.type)) return visit(node.expression, parent, key, scopes);
    if (node.type === "TSParameterProperty") return visit(node.parameter, parent, key, scopes);
    if (node.type.startsWith("TS")) return;
    const inner = SCOPES.has(node.type) && node !== unit ? [...scopes, declaredBy(node)] : scopes;
    if (counting) count++;
    if (node.type === "Identifier") {
      if (isName(parent, key)) {
        tokens.push(`.${node.name}`);
        return;
      }
      const scope = scopes.findLast(({ names }) => names.has(node.name));
      tokens.push(scope ? symbolFor(scope, node.name) : `#${node.name}`);
      return;
    }
    tokens.push(node.type);
    if (node.type === "Literal") {
      tokens.push(
        node.regex
          ? `/${node.regex.pattern}/${node.regex.flags}`
          : JSON.stringify(typeof node.value === "bigint" ? `${node.value}n` : node.value),
      );
    } else if (node.type === "TemplateElement") tokens.push(JSON.stringify(node.value.cooked));
    else if (node.type === "JSXText") tokens.push(JSON.stringify(node.value.trim().replace(/\s+/g, " ")));
    else if (node.type === "JSXIdentifier") tokens.push(node.name);
    for (const flag of FLAGS) {
      if (node[flag] !== undefined) tokens.push(`${flag}=${node[flag]}`);
    }
    if ((node.type === "MemberExpression" || node.type === "CallExpression") && node.optional === true) {
      tokens.push("optional");
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(childKey) || (node === unit && childKey === "id")) continue;
      if (typeof value === "object" && value !== null) visit(value, node, childKey, inner);
    }
    tokens.push(")");
  };

  const root = [declaredBy(unit)];
  if (FUNCTIONS.has(unit.type)) {
    for (const param of unit.params) visit(param, unit, "params", root);
    counting = true;
    visit(unit.body, unit, "body", root);
  } else {
    counting = true;
    visit(unit, null, null, root);
  }
  return { nodes: count, text: `${FUNCTIONS.has(unit.type) ? "fn" : "cond"} ${tokens.join(" ")}` };
}

/**
 * @param {Node} node
 * @param {Node | null} parent
 * @param {string | null} key
 * @returns {string | undefined}
 */
function enclosingName(node, parent, key) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === "VariableDeclarator" && key === "init" && parent.id?.type === "Identifier") {
    return parent.id.name;
  }
  if ((parent?.type === "Property" || parent?.type === "MethodDefinition") && key === "value" && !parent.computed && parent.key) {
    return parent.key.name ?? String(parent.key.value);
  }
  return undefined;
}

/**
 * @param {string} file
 * @param {string} source
 * @returns {Candidate[]}
 */
function candidatesIn(file, source) {
  const result = parseSync(file, source, { lang: file.endsWith("x") ? "tsx" : "ts" });
  if (result.errors.length > 0) throw new Error(`duplicates could not parse ${file}. ${result.errors[0].message}`);
  /** @type {Candidate[]} */
  const found = [];
  /**
   * @param {unknown} node
   * @param {Node | null} parent
   * @param {string | null} key
   * @param {string[]} path
   */
  const visit = (node, parent, key, path) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent, key, path);
      return;
    }
    if (!isNode(node)) return;
    let inner = path;
    if (FUNCTIONS.has(node.type) || node.type === "ConditionalExpression") {
      const named = enclosingName(node, parent, key);
      const { nodes, text } = normalizeUnit(node);
      if (nodes >= MIN_NODES) {
        found.push({
          file,
          start: node.start,
          end: node.end,
          line: source.slice(0, node.start).split("\n").length,
          nodes,
          fingerprint: createHash("sha1").update(text).digest("hex"),
          path: [...path, named ?? (FUNCTIONS.has(node.type) ? "fn" : "cond")].join(">"),
        });
      }
      if (named) inner = [...path, named];
    } else if (node.type === "ClassDeclaration" && node.id) {
      inner = [...path, node.id.name];
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(childKey) || typeof value !== "object" || value === null) continue;
      visit(value, node, childKey, inner);
    }
  };
  visit(result.program, null, null, []);
  return found;
}

/**
 * @param {Candidate[]} members Every unit with one fingerprint.
 * @returns {Candidate[]} The members that no other member in the same file contains.
 */
function outermost(members) {
  /** @type {Candidate[]} */
  const kept = [];
  for (const member of members.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start || b.end - a.end)) {
    const last = kept.at(-1);
    if (last?.file !== member.file || member.end > last.end) kept.push(member);
  }
  return kept;
}

/**
 * A larger group claims its spans, so a smaller group reports only the members outside every claimed span.
 * @param {Candidate[]} candidates
 * @returns {import("../registry.mjs").Finding[]}
 */
function findingsFrom(candidates) {
  /** @type {Candidate[]} */
  const claimed = [];
  const groups = [...Map.groupBy(candidates, ({ fingerprint }) => fingerprint).values()]
    .map(outermost)
    .filter((members) => members.length > 1)
    .sort((a, b) => b[0].nodes - a[0].nodes || a[0].fingerprint.localeCompare(b[0].fingerprint));
  const shown = (/** @type {Candidate} */ { file, line, path }) => `${file}:${line} (${path})`;
  /** @type {Map<string, number>} */
  const seen = new Map();
  return groups
    .flatMap((members) => {
      const live = members.filter(
        (member) => !claimed.some((span) => span.file === member.file && member.start >= span.start && member.end <= span.end),
      );
      claimed.push(...live);
      return live.map((member) => ({ member, others: members.filter((other) => other !== member) }));
    })
    .sort((a, b) => a.member.file.localeCompare(b.member.file) || a.member.start - b.member.start)
    .map(({ member, others }) => {
      const base = `${member.file}#${member.path}`;
      const ordinal = (seen.get(base) ?? 0) + 1;
      seen.set(base, ordinal);
      return {
        key: ordinal === 1 ? base : `${base}@${ordinal}`,
        fix: `${shown(member)} has the same ${member.nodes} normalized AST nodes as ${others.map(shown).join(", ")}. Move the shared logic to the module that owns the concept and import it from every caller.`,
      };
    });
}

/**
 * @param {import("../repo.mjs").Repo} repo
 * @returns {string[]}
 */
function sources(repo) {
  return repo.files().filter((path) => SCANNED.test(path) && !SKIPPED.test(path));
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "duplicates",
  since: "0.8.0",
  doc: {
    enforces: "No two function bodies or conditional expressions of 8 or more AST nodes match once types are dropped and the names they declare are renamed. It reads tracked `.ts` and `.tsx` files, except `.d.ts`, `*.test.*`, `*.spec.*`, `*.stories.*` and `test`, `tests` and `__tests__` folders.",
    fix: "Move the shared logic to the module that owns it and import it everywhere.",
    config: [],
  },
  subject: "tree",
  baseline: false,
  retired: ["scripts/check-duplicates.mjs", "scripts/check-duplicates.test.mjs", "scripts/baselines/duplicates.json"],
  applies: (repo) =>
    sources(repo).length > 0 ? { on: true } : { on: false, because: "git tracks no TypeScript source to scan" },
  run(repo) {
    return findingsFrom(sources(repo).flatMap((file) => candidatesIn(file, repo.read(file))));
  },
};
