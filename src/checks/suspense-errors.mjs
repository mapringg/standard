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
const LAYOUT = /^layout\.[jt]sx?$/;
const LISTED = `wrap the <Suspense> in a component that error-boundaries in ${FILE} lists.`;

/** @type {(program: Node) => Map<string, Imported>} */
function importsOf(program) {
  return new Map(program.body.flatMap((/** @type {Node} */ node) => (node.type === "ImportDeclaration" && node.importKind !== "type"
    ? node.specifiers.map((/** @type {Node} */ item) => [item.local.name, { module: node.source.value, name: item.type === "ImportSpecifier" ? item.imported.name ?? item.imported.value : item.type === "ImportDefaultSpecifier" ? "default" : "*" }])
    : [])));
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
    enforces: "A `<Suspense>` in a file under a Next app's `app` folder sits under an error boundary: an `error.*` in its route segment or a parent, a `global-error.*` at the app root, or a component that `error-boundaries` lists around it in the same file. A layout's own segment's `error.*` does not count.",
    fix: "Add an `error.tsx` to the segment or a parent, or wrap the `<Suspense>` in a listed error boundary.",
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
    return routed.flatMap(({ path, root }) => {
      const folder = posix.dirname(path);
      const layout = LAYOUT.test(posix.basename(path));
      let covered = has(root, "global-");
      for (let at = folder; !covered; at = posix.dirname(at)) {
        covered = (!layout || at !== folder) && has(at, "");
        if (at === root) break;
      }
      if (covered) return [];
      const text = repo.read(path);
      const { program, errors } = parseSource(path, text, { preserveParens: false });
      if (errors.length > 0) return [];
      const imports = importsOf(program);
      /** @type {(tag: Imported | null) => boolean} */
      const isBoundary = (tag) => tag !== null && listed.some(({ source, name }) => name === tag.name && (source === tag.module || target(path, tag.module) === source));
      const lines = /** @type {number[]} */ ([]);
      /** @type {(node: unknown, guarded: boolean) => void} */
      const walk = (node, guarded) => {
        if (Array.isArray(node)) return node.forEach((item) => walk(item, guarded));
        const value = /** @type {Node | null} */ (node);
        if (typeof value?.type !== "string") return;
        if (value.type === "JSXElement") {
          const tag = tagOf(value.openingElement.name, imports);
          if (!guarded && tag?.module === "react" && tag.name === "Suspense") lines.push(text.slice(0, value.start).split("\n").length);
          return walk([value.openingElement.attributes, value.children], guarded || isBoundary(tag));
        }
        Object.values(value).forEach((child) => walk(child, guarded));
      };
      walk(program.body, false);
      const unique = [...new Set(lines)];
      const shown = `line${unique.length > 1 ? "s" : ""} ${unique.join(", ")}`;
      const fix = layout
        ? `A segment's error.tsx does not catch its own layout, so add an error.tsx to a parent of ${folder}, or a global-error.tsx for the root layout, or ${LISTED}`
        : `Add an error.tsx to ${folder} or a parent segment, or ${LISTED}`;
      return lines.map(() => ({ key: `${path} Suspense`, fix: `${path} renders <Suspense> on ${shown}, and no error boundary wraps it. ${fix}` }));
    });
  },
};
