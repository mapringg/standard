import { DATA, EFFECT, parseName } from "../roles.mjs";

const ROLES = [...DATA.map((reason) => `data-${reason}`), ...EFFECT.map((reason) => `effect-${reason}`)];

export default /** @type {Parameters<import("oxlint/plugins-dev").RuleTester["run"]>[1]} */ ({
  meta: { type: "problem", docs: { description: "Role segments use a known reason and sit before .browser, .server and .test; .cache only as <name>.cache.ts.", fix: "Rename the file to <name>.<role>-<reason>.<ext>." }, schema: [], messages: { name: `Name the role as <name>.<role>-<reason> before .browser, .server and .test: ${ROLES.join(", ")}, or <name>.cache.ts, which cached-modules matches.` } },
  create(context) {
    if (parseName(context.filename).wrong.length === 0) return {};
    return { Program(node) { context.report({ node, messageId: "name" }); } };
  },
});
