import { UI_APPS, locate, moduleVisitors } from "./paths.mjs";

const SHARED = /^@\/(?:lib|components)(?:\/|$)/;

export default {
  meta: {
    type: "problem",
    docs: { description: "Features import only themselves and shared code; features meet in routes." },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where?.feature || !where.kind) return {};
    const own = `@/features/${where.feature}/`;
    return moduleVisitors((source, node) => {
      if (!source.startsWith("@/") || source.startsWith(own)) return;
      const other = /^@\/features\/([^/]+)\/([^/]+)$/.exec(source);
      if (where.kind === "api") {
        if (other && /^(?:db|schema)(?:\.ts)?$/.test(other[2])) return;
        if (!other) return;
        context.report({
          node,
          message: `Import only db.ts or schema.ts from another feature, and move shared queries into the feature that owns the data.`,
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
