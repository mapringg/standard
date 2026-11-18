import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { shipsToBrowser, viteApp } from "../browser.mjs";
import { inType, keyName, typeofOperand } from "../hooks.mjs";
import { DATA, rolesOf, withSegment } from "../roles.mjs";

const HOOKS = new Set(["useSWR", "useSWRInfinite", "useSWRSubscription", "useServerData", "useServerSeeded"]);
const TEMPLATE = /(?:^|\/)lib\/swr(?:\.browser)?(?:\.[cm]?[jt]sx?)?$|^swr(?:\/|$)/;
const API = /(?:^|\/)lib\/api(?:\/|$)/;
const CLIENTS = new Set(["ky", "axios"]);
const GLOBALS = new Set(["fetch", "XMLHttpRequest", "EventSource", "WebSocket"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);
const QUERY = new Set(["useQuery", "useInfiniteQuery", "useSuspenseQuery", "useSuspenseInfiniteQuery", "useQueries", "useSuspenseQueries"]);

/** @param {any} node @returns {string | undefined} The text of a string literal or a template without expressions. */
const text = (node) => node?.type === "Literal" && typeof node.value === "string" ? node.value : node?.type === "TemplateLiteral" && node.expressions.length === 0 ? node.quasis[0].value.cooked : undefined;

/** @param {string} filename Whether the file sits in the src folder of a Vite React app, which has index.html or a vite config beside its manifest. */
function viteSource(filename) {
  for (let folder = dirname(filename); dirname(folder) !== folder; folder = dirname(folder)) {
    const path = join(folder, "package.json");
    if (!existsSync(path)) continue;
    return relative(folder, filename).split(sep)[0] === "src" && viteApp(folder, JSON.parse(readFileSync(path, "utf8")));
  }
  return false;
}

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "Browser data loading runs only in .data-pages, .data-live, .data-client-state and .data-unreachable files.", fix: "Read the data in a Server Component, or name the file with its data role." }, schema: [], messages: { data: "Read the data in a Server Component and pass it down as props, or name the file {{name}} when the browser must load it." } },
  create(context) {
    const path = productPath(context);
    if (NOT_PRODUCT.test(path) || /(?:^|\/)src\/lib\/(?:swr(?:\.browser)?\.ts|api\/)/.test(path) || rolesOf(context.filename).data || viteSource(context.filename)) return {};
    const data = { name: withSegment(path, `data-<${DATA.join("|")}>`) };
    /** @type {boolean | undefined} */
    let browser;
    /** @param {NonNullable<Parameters<typeof context.report>[0]["node"]>} node */
    const inBrowser = (node) => {
      browser ??= shipsToBrowser(context);
      if (browser) context.report({ node, messageId: "data", data });
    };
    /** @param {any} node Whether an identifier is an unshadowed global. */
    const global = (node) => {
      const reference = context.sourceCode.getScope(node).references.find((item) => item.identifier === node);
      return Boolean(reference && !reference.resolved?.defs.length);
    };
    /** @param {string | undefined} source */
    const client = (source) => source !== undefined && (CLIENTS.has(source.split("/")[0]) || API.test(source));
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const source = node.source.value;
        if (source === "@tanstack/react-query") {
          for (const specifier of node.specifiers) if (specifier.type !== "ImportSpecifier" || specifier.importKind !== "type" && QUERY.has(keyName(specifier.imported))) context.report({ node: specifier, messageId: "data", data });
        } else if (TEMPLATE.test(source)) {
          for (const specifier of node.specifiers) {
            const name = specifier.type === "ImportSpecifier" ? keyName(specifier.imported) : source.startsWith("swr") ? "useSWR" : "";
            if (specifier.type !== "ImportSpecifier" || specifier.importKind !== "type") if (HOOKS.has(name)) context.report({ node: specifier, messageId: "data", data });
          }
        } else if (client(source)) inBrowser(node);
      },
      ImportExpression(node) {
        if (client(text(node.source))) inBrowser(node);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require" && client(text(node.arguments[0]))) inBrowser(node);
      },
      Identifier(node) {
        if (inType(node) || typeofOperand(node)) return;
        if (GLOBALS.has(node.name)) { if (global(node)) inBrowser(node); return; }
        if (!GLOBAL_OBJECTS.has(node.name) || !global(node)) return;
        const parent = /** @type {any} */ (node).parent;
        const member = parent.type === "MemberExpression" && parent.object === node;
        if (member && typeofOperand(parent)) return;
        const probe = parent.type === "BinaryExpression" && parent.operator === "in" && parent.right === node && parent.left.type === "Literal";
        const name = member && (!parent.computed || parent.property.type === "Literal") || probe ? keyName(member ? parent.property : parent.left) : undefined;
        if (name === undefined || GLOBALS.has(name)) inBrowser(member ? parent : node);
      },
    };
  },
});
