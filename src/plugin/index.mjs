import agentDocs from "./agent-docs.mjs";
import featureImports from "./feature-imports.mjs";
import hono from "./hono.mjs";
import nextData from "./next-data.mjs";
import nextRoutes from "./next-routes.mjs";
import noChainedAssertions from "./no-chained-assertions.mjs";
import noComments from "./no-comments.mjs";
import noReturnTypes from "./no-return-types.mjs";
import noTypeof from "./no-typeof.mjs";
import owners from "./owners.mjs";
import params from "./params.mjs";
import prCheck from "./pr-check.mjs";
import queryClient from "./query-client.mjs";
import reducer from "./reducer.mjs";
import repoShape from "./repo-shape.mjs";
import serverActions from "./server-actions.mjs";
import styleProp from "./style-prop.mjs";
import tests from "./tests.mjs";

export default {
  meta: { name: "standard" },
  rules: {
    "agent-docs": agentDocs,
    "feature-imports": featureImports,
    hono,
    "next-data": nextData,
    "next-routes": nextRoutes,
    "no-chained-assertions": noChainedAssertions,
    "no-comments": noComments,
    "no-return-types": noReturnTypes,
    "no-typeof": noTypeof,
    owners,
    params,
    "pr-check": prCheck,
    "query-client": queryClient,
    reducer,
    "repo-shape": repoShape,
    "server-actions": serverActions,
    "style-prop": styleProp,
    tests,
  },
};
