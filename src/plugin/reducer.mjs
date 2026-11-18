import { stem } from "./paths.mjs";

const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) if (FUNCTION.has(current.type)) return current;
  return null;
}

function isReducerCall(node) {
  const callee = node.callee;
  return (
    (callee.type === "Identifier" && callee.name === "useReducer") ||
    (callee.type === "MemberExpression" && callee.property.name === "useReducer")
  );
}

function returnsSecondParam(node) {
  const second = node.params[1];
  if (second?.type !== "Identifier") return false;
  const body = node.body;
  if (body.type === "Identifier") return body.name === second.name;
  if (body.type !== "BlockStatement" || body.body.length !== 1) return false;
  const only = body.body[0];
  return only.type === "ReturnStatement" && only.argument?.type === "Identifier" && only.argument.name === second.name;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "One useReducer per component, with its reducer from a <feature>-state.ts file." },
  },
  create(context) {
    const counts = new Map();
    const stateImports = new Set();
    const setterCheck = (node) => {
      if (returnsSecondParam(node))
        context.report({ node, message: "A reducer that returns its action is useState. Model named actions." });
    };
    return {
      ImportDeclaration(node) {
        if (!/-state(?:\.[cm]?[jt]sx?)?$/.test(node.source.value)) return;
        for (const specifier of node.specifiers) stateImports.add(specifier.local.name);
      },
      CallExpression(node) {
        if (!isReducerCall(node)) return;
        const owner = enclosingFunction(node);
        const count = (counts.get(owner) ?? 0) + 1;
        counts.set(owner, count);
        if (count === 2)
          context.report({
            node,
            message: "At most one useReducer per component. Merge the state into one union in <feature>-state.ts.",
          });
        const reducer = node.arguments[0];
        const fromState =
          reducer?.type === "Identifier"
            ? stateImports.has(reducer.name)
            : reducer?.type === "MemberExpression" &&
              reducer.object.type === "Identifier" &&
              stateImports.has(reducer.object.name);
        if (!fromState)
          context.report({
            node: reducer ?? node,
            message:
              "Import the reducer from <feature>-state.ts, next to its state and action unions and initial value.",
          });
      },
      ...(stem(context.filename).endsWith("-state")
        ? Object.fromEntries([...FUNCTION].map((type) => [type, setterCheck]))
        : {}),
    };
  },
};
