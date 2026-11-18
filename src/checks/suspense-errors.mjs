import { posix } from "node:path";

import { FILE } from "../config.mjs";
import { dependents, NOT_PRODUCT } from "./support/packages.mjs";
import { targets } from "./support/reach.mjs";
import { sourceFacts } from "./support/source.mjs";
import { parseSource } from "./support/sources.mjs";

/**
 * @typedef {{ type: string, [key: string]: any }} Node
 * @typedef {{ module: string, name: string }} Imported A top-level import: its specifier, and the export it binds, `*` for a namespace.
 */

const ERROR_FILE = /^(global-)?error\.[jt]sx?$/;
const LAYOUT = /^(layout|template)\.[jt]sx?$/;
const LOADING = /^loading\.[jt]sx?$/;
const LISTED = `wrap the <Suspense> in a component that error-boundaries in ${FILE} lists or that catchError makes in the same file.`;

/** @type {(program: Node) => Map<string, Imported>} */
function importsOf(program) {
  return new Map(program.body.flatMap((/** @type {Node} */ node) => (node.type === "ImportDeclaration" && node.importKind !== "type"
    ? node.specifiers.map((/** @type {Node} */ item) => [item.local.name, { module: node.source.value, name: item.type === "ImportSpecifier" ? item.imported.name ?? item.imported.value : item.type === "ImportDefaultSpecifier" ? "default" : "*" }])
    : [])));
}

/** @type {(program: Node, imports: Map<string, Imported>) => Set<string>} The top-level names that `catchError` from `next/error` makes. */
function caughtOf(program, imports) {
  const made = (/** @type {Node | null} */ init) => init?.type === "CallExpression" && init.callee.type === "Identifier" && imports.get(init.callee.name)?.module === "next/error" && imports.get(init.callee.name)?.name === "catchError";
  return new Set(program.body.flatMap((/** @type {Node} */ node) => {
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    return declaration?.type === "VariableDeclaration" ? declaration.declarations.filter((/** @type {Node} */ item) => item.id.type === "Identifier" && made(item.init)).map((/** @type {Node} */ item) => item.id.name) : [];
  }));
}

/** @type {(name: Node, imports: Map<string, Imported>) => Imported | null} The export a JSX tag names: `Tag` from a named import, or `Lib.Tag` from a namespace or default import. */
function tagOf(name, imports) {
  if (name.type === "JSXIdentifier") return imports.get(name.name) ?? null;
  if (name.type !== "JSXMemberExpression" || name.object.type !== "JSXIdentifier") return null;
  const namespace = imports.get(name.object.name);
  return namespace && (namespace.name === "*" || namespace.name === "default") ? { module: namespace.module, name: name.property.name } : null;
}

/**
 * @param {readonly string[]} apps
 * @param {string} path
 * @returns {string | null} The `app` folder of the Next app that holds path, when path sits in it.
 */
function appRootOf(apps, path) {
  for (const app of apps) {
    for (const root of ["app", "src/app"].map((folder) => posix.join(app, folder))) if (path.startsWith(`${root}/`)) return root;
  }
  return null;
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "suspense-errors",
  since: "0.14.16",
  doc: {
    enforces: "A `<Suspense>` in a file under a Next app's `app` folder, and each `loading.*` there, sits under an error boundary: an `error.*` in its route segment or a parent, a `global-error.*` at the app root, or a component around it in the same file that `error-boundaries` lists or `catchError` makes. A layout's or template's own segment's `error.*` does not count.",
    fix: "Add an `error.tsx` to the segment or a parent, or a `global-error.tsx` for the root layout, or wrap the `<Suspense>` in a listed or `catchError` error boundary.",
    config: ["error-boundaries"],
  },
  subject: "tree",
  retired: [],
  applies: (repo) => (dependents(repo, "next").length > 0 ? { on: true } : { on: false, because: "no tracked package.json declares next" }),
  async run(repo) {
    const apps = dependents(repo, "next").map((app) => (app === "." ? "" : app));
    const errorFiles = new Set(repo.files().filter((path) => ERROR_FILE.test(posix.basename(path))));
    const has = (/** @type {string} */ folder, /** @type {string} */ prefix) => ["js", "jsx", "ts", "tsx"].some((extension) => errorFiles.has(posix.join(folder, `${prefix}error.${extension}`)));
    const files = sourceFacts(repo).flatMap((file) => ("error" in file ? [] : [file]));
    const routed = files.flatMap((file) => {
      const root = NOT_PRODUCT.test(file.path) ? null : appRootOf(apps, file.path);
      return root === null ? [] : [{ path: file.path, root }];
    });
    const listed = repo.config.errorBoundaries.map((entry) => ({ source: entry.slice(0, entry.lastIndexOf("#")), name: entry.slice(entry.lastIndexOf("#") + 1) }));
    const resolve = listed.length > 0 ? await targets(repo) : () => null;
    /** @type {(file: string, specifier: string) => string | null} */
    const target = (file, specifier) => {
      const found = resolve(file, specifier);
      return found === null || found.startsWith("../") || found.split("/").includes("node_modules") ? null : found;
    };
    /** @type {(folder: string, root: string, own: boolean) => boolean} */
    const covered = (folder, root, own) => {
      if (has(root, "global-")) return true;
      for (let at = folder; ; at = posix.dirname(at)) {
        if ((own || at !== folder) && has(at, "")) return true;
        if (at === root) return false;
      }
    };
    const loadings = repo.files().flatMap((path) => {
      const root = LOADING.test(posix.basename(path)) && !NOT_PRODUCT.test(path) ? appRootOf(apps, path) : null;
      const folder = posix.dirname(path);
      return root === null || covered(folder, root, true) ? [] : [{ key: `${path} Suspense`, fix: `${path} is the Suspense boundary of ${folder}, and no error boundary covers it. Add an error.tsx to ${folder} or a parent segment, or a global-error.tsx to the app folder.` }];
    });
    return [...loadings, ...routed.flatMap(({ path, root }) => {
      const folder = posix.dirname(path);
      const kind = LAYOUT.test(posix.basename(path)) ? posix.basename(path).split(".")[0] : null;
      if (covered(folder, root, kind === null)) return [];
      const text = repo.read(path);
      const { program, errors } = parseSource(path, text, { preserveParens: false });
      if (errors.length > 0) return [];
      const imports = importsOf(program);
      const caught = caughtOf(program, imports);
      /** @type {(tag: Imported | null) => boolean} */
      const isBoundary = (tag) => tag !== null && listed.some(({ source, name }) => name === tag.name && (source === tag.module || target(path, tag.module) === source));
      const sites = /** @type {{ line: number, column: number }[]} */ ([]);
      /** @type {(node: unknown, guarded: boolean) => void} */
      const walk = (node, guarded) => {
        if (Array.isArray(node)) return node.forEach((item) => walk(item, guarded));
        const value = /** @type {Node | null} */ (node);
        if (typeof value?.type !== "string") return;
        if (value.type === "JSXElement") {
          const tag = tagOf(value.openingElement.name, imports);
          if (!guarded && tag?.module === "react" && tag.name === "Suspense") {
            const before = text.slice(0, value.start).split("\n");
            sites.push({ line: before.length, column: (before.at(-1) ?? "").length + 1 });
          }
          const name = value.openingElement.name;
          return walk([value.openingElement.attributes, value.children], guarded || isBoundary(tag) || (name.type === "JSXIdentifier" && caught.has(name.name)));
        }
        Object.values(value).forEach((child) => walk(child, guarded));
      };
      walk(program.body, false);
      const shared = (/** @type {number} */ line) => sites.filter((site) => site.line === line).length > 1;
      const shown = `line${sites.length > 1 ? "s" : ""} ${sites.map(({ line, column }) => (shared(line) ? `${line}:${column}` : `${line}`)).join(", ")}`;
      const fix = kind === null
        ? `Add an error.tsx to ${folder} or a parent segment, or ${LISTED}`
        : folder === root
          ? `No error.tsx catches the root ${kind}, so add a global-error.tsx to ${root}, or ${LISTED}`
          : `A segment's error.tsx does not catch its own ${kind}, so add an error.tsx to a parent of ${folder}, or ${LISTED}`;
      return sites.map(() => ({ key: `${path} Suspense`, fix: `${path} renders <Suspense> on ${shown}, and no error boundary wraps it. ${fix}` }));
    })];
  },
};
