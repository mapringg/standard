import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import { parseSync } from "oxc-parser";
import { NOT_PRODUCT, packageOf } from "../checks/support/packages.mjs";

/** @param {string} folder @param {Record<string, unknown> | undefined} manifest Whether the package is a Vite React app: react and vite without next, and index.html or a vite config beside the manifest. */
export function viteApp(folder, manifest) {
  const deps = { ...(/** @type {any} */ (manifest)?.dependencies), ...(/** @type {any} */ (manifest)?.devDependencies) };
  return Boolean(deps.react && deps.vite && !deps.next) && (existsSync(join(folder, "index.html")) || readdirSync(folder).some((/** @type {string} */ name) => /^vite\.config\.[cm]?[jt]s$/.test(name)));
}

/** @type {ResolverFactory | undefined} */
let shared;

/** @param {string} from @param {string} specifier @returns {string | undefined} The project file a specifier resolves to from a file, through relative paths, tsconfig paths and package.json imports, or undefined for a package or an unresolved specifier. */
export function projectFile(from, specifier) {
  shared ??= new ResolverFactory({ tsconfig: "auto", conditionNames: ["browser", "import", "default"], mainFields: ["browser", "module", "main"], extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"], extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] } });
  const path = shared.resolveFileSync(from, specifier).path;
  return path && !path.split(/[\\/]/).includes("node_modules") ? path : undefined;
}

/** @param {any} node @returns {string | undefined} The text of a string literal or a template without expressions. */
export const staticText = (node) => node?.type === "Literal" && typeof node.value === "string" ? node.value : node?.type === "TemplateLiteral" && node.expressions.length === 0 ? node.quasis[0].value.cooked : undefined;

/** @type {Map<string, Set<string>>} */
const graphs = new Map();

/** @param {{ filename: string, cwd: string }} context */
export function shipsToBrowser(context) {
  let root = context.cwd;
  for (let folder = root; ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git"))) { root = folder; break; }
    if (dirname(folder) === folder) break;
  }
  if (!graphs.has(root)) {
    const options = { cwd: root, exclude: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/dist/**"] };
    const manifests = new Map(globSync("**/package.json", options).map((path) => [path, JSON.parse(readFileSync(join(root, path), "utf8"))]));
    const paths = new Set(manifests.keys());
    const resolver = new ResolverFactory({ tsconfig: "auto", conditionNames: ["browser", "import", "default"], mainFields: ["browser", "module", "main"], extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"], extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] } });
    const edges = new Map();
    const browser = new Set();
    for (const path of globSync("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", options).filter((path) => !NOT_PRODUCT.test(path))) {
      const absolute = join(root, path);
      const { program } = parseSync(path, readFileSync(absolute, "utf8"));
      const directives = program.body.flatMap((node) => node.type === "ExpressionStatement" && node.directive ? [node.directive] : []);
      if (directives.includes("use server")) continue;
      const folder = packageOf(paths, path);
      const manifest = folder === null ? {} : manifests.get(join(folder, "package.json"));
      if (directives.includes("use client") || /\.browser\.[^/]+$/.test(path) || folder !== null && relative(folder, path).startsWith("src/") && viteApp(join(root, folder), manifest)) browser.add(absolute);
      /** @type {string[]} */
      const imports = [];
      /** @param {unknown} node */
      function visit(node) {
        if (!node || typeof node !== "object") return;
        const { type, source, importKind, exportKind, callee, arguments: args } = /** @type {{ type?: string, source?: { value?: unknown }, importKind?: string, exportKind?: string, callee?: { name?: string }, arguments?: { value?: unknown }[] }} */ (node);
        if (importKind === "type" || exportKind === "type") return;
        const value = source?.value ?? (type === "CallExpression" && callee?.name === "require" ? args?.[0]?.value : undefined);
        if (typeof value === "string") imports.push(value);
        Object.values(node).forEach(visit);
      }
      visit(program);
      edges.set(absolute, imports.flatMap((specifier) => { const path = resolver.resolveFileSync(absolute, specifier).path; return path && !path.includes("/node_modules/") ? [path] : []; }));
    }
    for (const file of browser) for (const target of edges.get(file) ?? []) if (edges.has(target)) browser.add(target);
    graphs.set(root, browser);
  }
  return graphs.get(root)?.has(context.filename) ?? false;
}
