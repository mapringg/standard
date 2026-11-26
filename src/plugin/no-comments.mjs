import { isGenerated } from "./paths.mjs";

export default {
  meta: {
    type: "problem",
    docs: { description: "Code carries no comments of any kind, including disable directives." },
  },
  create(context) {
    if (isGenerated(context.filename)) return {};
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          context.report({
            loc: comment.loc,
            message:
              "Delete the comment and name things so the code explains itself, with lasting context in README.md or AGENTS.md.",
          });
        }
      },
    };
  },
};
