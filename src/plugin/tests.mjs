import { isTestSupport } from "./paths.mjs";

const TESTS = new Set(["test", "it"]);
const BLOCKS = new Set(["test", "it", "describe", "suite"]);
const MOCKERS = new Set(["vi", "jest"]);
const MOCKS = new Set(["mock", "doMock", "unstable_mockModule", "setMock", "stubGlobal", "stubEnv", "mocked"]);
const FAKES =
  /^(?:mockImplementation|mockImplementationOnce|mockReturnValue|mockReturnValueOnce|mockResolvedValue|mockResolvedValueOnce|mockRejectedValue|mockRejectedValueOnce)$/;
const DOUBLE = "Fake HTTP with MSW handlers and other boundaries with a typed fake in *.fixture.ts.";
const HTTP_FAKE = "Fake HTTP with MSW handlers instead of a fetch fake.";
const RENDERS = new Set(["render", "renderRouter", "renderHook", "mount"]);
const PRESENCE = new Set(["toBeInTheDocument", "toBeTruthy", "toBeDefined", "toBeVisible", "toBeOnTheScreen"]);
const CALL_CHECK =
  /^(?:toHaveBeenCalled|toBeCalled|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|lastCalledWith|nthCalledWith)/;
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const FUNCTION = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const BEFORE_HOOKS = new Set(["beforeEach", "beforeAll"]);
const AFTER_HOOKS = new Set(["afterEach", "afterAll"]);
const FAKE_TIMERS = new Set(["useFakeTimers", "setSystemTime"]);
const TIMER_CALLS = new Set([...FAKE_TIMERS, "useRealTimers"]);
const HTTP_SERVERS = /^(?:express|(?:node:)?https?)$/;
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

function calledName(call) {
  return call.callee.type === "Identifier" ? call.callee.name : null;
}

function timerScope(node) {
  for (let current = node.parent; current; current = current.parent) {
    const call = current.parent;
    if (!FUNCTION.has(current.type) || call?.type !== "CallExpression" || !call.arguments.includes(current)) continue;
    if (AFTER_HOOKS.has(calledName(call))) return null;
    if (BEFORE_HOOKS.has(calledName(call))) {
      const scope = timerScope(call);
      return scope && { container: scope.container, start: scope.container?.range[0] ?? 0 };
    }
    if (isBlock(call, BLOCKS)) return { container: current, start: node.range[0] };
  }
  return { container: null, start: node.range[0] };
}

function contains(outer, inner) {
  return !outer || (outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1]);
}

function strictListen(node) {
  const options = node.arguments[0];
  return (
    options?.type === "ObjectExpression" &&
    options.properties.some(
      (item) =>
        ["onUnhandledRequest", "onUnhandledFrame"].includes(item.key?.name ?? item.key?.value) &&
        item.value.value === "error",
    )
  );
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
    docs: { description: "Tests are deterministic, assert outcomes and fake only the network, through MSW." },
  },
  create(context) {
    const name = context.filename.split(/[\\/]/).at(-1);
    if (CONFIG.test(name)) {
      return {
        Property(node) {
          const key = node.key?.name ?? node.key?.value;
          if (key === "thresholds" || key === "coverageThreshold")
            context.report({
              node,
              message: "Remove the coverage threshold; keep only tests that protect a contract.",
            });
        },
      };
    }
    if (!isTestSupport(name)) return {};
    const fixture = /\.fixture\.[cm]?[jt]sx?$/.test(name);
    const report = (node, message) => context.report({ node, message });
    const bodies = new Map();
    const clocks = [];
    const toggles = [];
    const faked = (node) => {
      const before = toggles.filter((item) => item.start < node.range[0] && contains(item.container, node));
      return (
        before.length > 0 &&
        before.reduce((last, item) =>
          item.start > last.start || (item.start === last.start && item.order > last.order) ? item : last,
        ).fake
      );
    };
    let msw = false;
    const servers = new Set();
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
          if (inLoop(node)) report(node, "Write one test.each with a table instead of a loop.");
          const args = node.arguments;
          if (typeof args[2]?.value === "number" || hasTimeout(args[2]) || hasTimeout(args[1]))
            report(node, "Drop the timeout and make the test fast and deterministic.");
          if (isBlock(node, TESTS)) {
            const body = args.findLast((arg) => FUNCTION.has(arg.type));
            if (body) bodies.set(body, { node, render: false, matchers: [] });
          }
        }
        if (memberCall(node, MOCKERS, TIMER_CALLS)) {
          const scope = timerScope(node);
          if (scope) toggles.push({ ...scope, order: node.range[0], fake: FAKE_TIMERS.has(property) });
        }
        if (memberCall(node, new Set(["Date", "performance"]), new Set(["now"]))) clocks.push(node);
        if (memberCall(node, MOCKERS, MOCKS) && !(fixture && property === "stubEnv")) report(node, DOUBLE);
        if (!fixture && memberCall(node, MOCKERS, new Set(["fn"])) && node.arguments.length > 0) report(node, DOUBLE);
        if (!fixture && property && FAKES.test(property)) report(node, DOUBLE);
        if (property === "defineProperty" && rootName(callee) === "Object") report(node, DOUBLE);
        if (property === "listen" && msw && !servers.has(rootName(callee.object)) && !strictListen(node))
          report(
            node,
            'Start the MSW server with listen({ onUnhandledRequest: "error" }) (onUnhandledFrame in MSW 3).',
          );
        const body = bodyOf(node);
        if (!body) return;
        if (callee.type === "Identifier" && RENDERS.has(callee.name)) body.render = true;
        if (property?.startsWith("to") && rootName(callee) === "expect") body.matchers.push(property);
      },
      Property(node) {
        if (fixture && (node.key?.name ?? node.key?.value) === "fetch") report(node, HTTP_FAKE);
      },
      ImportDeclaration(node) {
        if (/^msw(?:\/|$)/.test(node.source.value)) msw = true;
        if (HTTP_SERVERS.test(node.source.value))
          for (const specifier of node.specifiers) servers.add(specifier.local.name);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init && servers.has(rootName(node.init))) servers.add(node.id.name);
      },
      AssignmentExpression(node) {
        const target = node.left;
        if (target.type !== "MemberExpression") return;
        const text = context.sourceCode.getText(target);
        if (fixture && node.operator === "??=" && /^(?:globalThis|window|self)\.\w+$/.test(text)) return;
        if (/(?:^|\.)prototype\./.test(text) || /^(?:globalThis|window|global|self)\./.test(text)) report(node, DOUBLE);
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Date" && node.arguments.length === 0)
          clocks.push(node);
      },
      WhileStatement(node) {
        report(node, "Await the real event instead of looping.");
      },
      DoWhileStatement(node) {
        report(node, "Await the real event instead of looping.");
      },
      "Program:exit"() {
        for (const node of clocks)
          if (!faked(node))
            report(node, "Call vi.useFakeTimers() and vi.setSystemTime() instead of reading the real clock.");
        for (const { node, render, matchers } of bodies.values()) {
          if (render && matchers.every((matcher) => PRESENCE.has(matcher)))
            report(node, "Assert behavior after an interaction, or delete the render-only test.");
          else if (matchers.length > 0 && matchers.every((matcher) => CALL_CHECK.test(matcher)))
            report(node, "Assert the outcome the user or caller sees, not only that a function was called.");
        }
      },
    };
  },
};
