import { isTest } from "./paths.mjs";

const TESTS = new Set(["test", "it"]);
const BLOCKS = new Set(["test", "it", "describe", "suite"]);
const MOCKERS = new Set(["vi", "jest"]);
const MOCKS = new Set(["mock", "doMock", "unstable_mockModule"]);
const RENDERS = new Set(["render", "renderRouter", "renderHook", "mount"]);
const PRESENCE = new Set(["toBeInTheDocument", "toBeTruthy", "toBeDefined", "toBeVisible", "toBeOnTheScreen"]);
const CALL_CHECK =
  /^(?:toHaveBeenCalled|toBeCalled|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|lastCalledWith|nthCalledWith)/;
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const FUNCTION = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const CONFIG = /^(?:vitest|vite|jest)\.config\.[cm]?[jt]s$/;

function rootName(node) {
  let current = node;
  while (current.type === "MemberExpression" || current.type === "CallExpression")
    current = current.type === "CallExpression" ? current.callee : current.object;
  return current.type === "Identifier" ? current.name : null;
}

function isBlock(node, names) {
  const callee = node.callee;
  if (callee.type === "CallExpression") return isBlock(callee, names);
  return names.has(rootName(callee) ?? "") && (callee.type === "Identifier" || callee.type === "MemberExpression");
}

function memberCall(node, object, properties) {
  const callee = node.callee;
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    object.has(callee.object.name) &&
    properties.has(callee.property.name)
  );
}

function inLoop(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (LOOPS.has(current.type)) return true;
    if (
      FUNCTION.has(current.type) &&
      current.parent?.type === "CallExpression" &&
      ["forEach", "map", "flatMap"].includes(current.parent.callee.property?.name)
    )
      return true;
  }
  return false;
}

function hasTimeout(node) {
  return (
    node?.type === "ObjectExpression" &&
    node.properties.some((property) => (property.key?.name ?? property.key?.value) === "timeout")
  );
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Tests are deterministic, assert outcomes and mock only what leaves the repo." },
  },
  create(context) {
    const name = context.filename.split(/[\\/]/).at(-1);
    if (CONFIG.test(name)) {
      return {
        Property(node) {
          const key = node.key?.name ?? node.key?.value;
          if (key === "thresholds" || key === "coverageThreshold")
            context.report({ node, message: "No coverage thresholds." });
        },
      };
    }
    if (!isTest(name)) return {};
    const report = (node, message) => context.report({ node, message });
    const bodies = new Map();
    const clocks = [];
    let fake = false;
    const bodyOf = (node) => {
      for (let current = node.parent; current; current = current.parent)
        if (bodies.has(current)) return bodies.get(current);
      return null;
    };
    return {
      CallExpression(node) {
        const callee = node.callee;
        const property = callee.type === "MemberExpression" ? callee.property.name : null;
        if (isBlock(node, BLOCKS)) {
          if (inLoop(node)) report(node, "No tests inside loops. Use test.each with a table.");
          const args = node.arguments;
          if (typeof args[2]?.value === "number" || hasTimeout(args[2]) || hasTimeout(args[1]))
            report(node, "No per-test timeouts. Make the test fast and deterministic.");
          if (isBlock(node, TESTS)) {
            const body = args.findLast((arg) => FUNCTION.has(arg.type));
            if (body) bodies.set(body, { node, render: false, matchers: [] });
          }
        }
        if (memberCall(node, MOCKERS, new Set(["useFakeTimers", "setSystemTime"]))) fake = true;
        if (memberCall(node, new Set(["Date", "performance"]), new Set(["now"]))) clocks.push(node);
        if (memberCall(node, MOCKERS, MOCKS)) {
          const target = node.arguments[0];
          const source = target?.type === "ImportExpression" ? target.source.value : target?.value;
          if (typeof source === "string" && /^(?:@\/|\.)/.test(source))
            report(
              node,
              "Mock only what leaves the repo (network, LINE SDK, next/*, time). Use the real in-repo module.",
            );
        }
        const body = bodyOf(node);
        if (!body) return;
        if (callee.type === "Identifier" && RENDERS.has(callee.name)) body.render = true;
        if (property?.startsWith("to") && rootName(callee) === "expect") body.matchers.push(property);
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Date" && node.arguments.length === 0)
          clocks.push(node);
      },
      WhileStatement(node) {
        report(node, "No polling loops in tests. Await the real event.");
      },
      DoWhileStatement(node) {
        report(node, "No polling loops in tests. Await the real event.");
      },
      "Program:exit"() {
        if (!fake)
          for (const node of clocks) report(node, "No real clock in tests. Use fake timers and set the system time.");
        for (const { node, render, matchers } of bodies.values()) {
          if (render && matchers.every((matcher) => PRESENCE.has(matcher)))
            report(node, "No render-only component tests. Assert behavior after an interaction, or drop the test.");
          else if (matchers.length > 0 && matchers.every((matcher) => CALL_CHECK.test(matcher)))
            report(node, "A test that only checks calls proves nothing. Assert the outcome.");
        }
      },
    };
  },
};
