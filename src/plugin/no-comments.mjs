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
              "Remove the comment. Name things so the code explains itself; put lasting context in README.md or AGENTS.md.",
          });
        }
      },
    };
  },
};
