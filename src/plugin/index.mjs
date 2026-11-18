import featureImports from "./feature-imports.mjs";
import hono from "./hono.mjs";
import importMetaEnv from "./import-meta-env.mjs";
import nextData from "./next-data.mjs";
import nextRoutes from "./next-routes.mjs";
import noChainedAssertions from "./no-chained-assertions.mjs";
import noComments from "./no-comments.mjs";
import noTypeof from "./no-typeof.mjs";
import params from "./params.mjs";
import reducer from "./reducer.mjs";
import repoShape from "./repo-shape.mjs";
import serverActions from "./server-actions.mjs";
import tests from "./tests.mjs";

export default {
  meta: { name: "standard" },
  rules: {
    "feature-imports": featureImports,
    hono,
    "next-data": nextData,
    "next-routes": nextRoutes,
    "no-chained-assertions": noChainedAssertions,
    "no-comments": noComments,
    "no-typeof": noTypeof,
    "import-meta-env": importMetaEnv,
    params,
    reducer,
    "repo-shape": repoShape,
    "server-actions": serverActions,
    tests,
  },
};
