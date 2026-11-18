import { UI_APPS, locate, moduleVisitors } from "./paths.mjs";

const SHARED = /^@\/(?:lib|components)(?:\/|$)/;
const SHARED_API = /^(?:db|schema)(?:\.ts)?$/;
const COMPOSED = /^(?:db|schema|service)(?:\.ts)?$/;

export default {
  meta: {
    type: "problem",
    docs: { description: "Features import only themselves and shared code; features meet in routes." },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where?.feature || !where.kind) return {};
    const own = `@/features/${where.feature}/`;
    const routes = where.local === `src/features/${where.feature}/routes.ts`;
    return moduleVisitors((source, node) => {
      if (!source.startsWith("@/") || source.startsWith(own)) return;
      const other = /^@\/features\/([^/]+)\/([^/]+)$/.exec(source);
      if (where.kind === "api") {
        if (!other || (routes ? COMPOSED : SHARED_API).test(other[2])) return;
        context.report({
          node,
          message: routes
            ? "Import only db.ts, schema.ts or service.ts from another feature."
            : "Import only db.ts or schema.ts from another feature, and compose services in routes.ts.",
        });
        return;
      }
      if (UI_APPS.has(where.kind) && !SHARED.test(source)) {
        context.report({
          node,
          message: `Compose ${source} with this feature in a route; a feature imports only itself, @/lib and @/components.`,
        });
      }
    });
  },
};
