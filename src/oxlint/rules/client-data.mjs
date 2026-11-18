import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { productPath } from "../fixed-path.mjs";
import { NOT_PRODUCT } from "../../checks/support/packages.mjs";
import { shipsToBrowser } from "../browser.mjs";
import { DATA, rolesOf, withSegment } from "../roles.mjs";

const HOOKS = new Set(["useSWR", "useSWRInfinite", "useSWRSubscription", "useServerData", "useServerSeeded"]);
const TEMPLATE = /(?:^|\/)lib\/swr(?:\.browser)?(?:\.[cm]?[jt]sx?)?$|^swr(?:\/|$)/;
const API = /(?:^|\/)lib\/api(?:\/|$)/;
const CLIENTS = new Set(["ky", "axios"]);
const GLOBALS = new Set(["fetch", "XMLHttpRequest", "EventSource", "WebSocket"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);

/** @param {string} filename Whether the file sits in the src folder of a Vite React app, which has index.html or a vite config beside its manifest. */
function viteSource(filename) {
  for (let folder = dirname(filename); dirname(folder) !== folder; folder = dirname(folder)) {
    const path = join(folder, "package.json");
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    const app = existsSync(join(folder, "index.html")) || readdirSync(folder).some((name) => /^vite\.config\.[cm]?[jt]s$/.test(name));
    return Boolean(deps.react && deps.vite && !deps.next) && app && relative(folder, filename).split(sep)[0] === "src";
  }
  return false;
}

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", schema: [], messages: { data: "Read the data in a Server Component and pass it down as props, or name the file {{name}} when the browser must load it." } },
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
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const source = node.source.value;
        if (TEMPLATE.test(source)) {
          for (const specifier of node.specifiers) {
            const name = specifier.type === "ImportSpecifier" ? specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value : source.startsWith("swr") ? "useSWR" : "";
            if (specifier.type !== "ImportSpecifier" || specifier.importKind !== "type") if (HOOKS.has(name)) context.report({ node: specifier, messageId: "data", data });
          }
        } else if (CLIENTS.has(source.split("/")[0]) || API.test(source)) inBrowser(node);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string" && API.test(node.source.value)) inBrowser(node);
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || !GLOBAL_OBJECTS.has(node.object.name) || node.computed || node.property.type !== "Identifier" || !GLOBALS.has(node.property.name)) return;
        const reference = context.sourceCode.getScope(node).references.find((item) => item.identifier === node.object);
        if (!reference?.resolved?.defs.length) inBrowser(node);
      },
      Identifier(node) {
        if (!GLOBALS.has(node.name)) return;
        const reference = context.sourceCode.getScope(node).references.find((item) => item.identifier === node);
        if (reference && !reference.resolved?.defs.length) inBrowser(node);
      },
    };
  },
});
