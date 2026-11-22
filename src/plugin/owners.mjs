import { matchesGlob } from "node:path";

import { exportedIds, importedName, isTestSupport, locate, moduleVisitors, testedStem } from "./paths.mjs";

const UI = ["web", "liff", "mobile", "marketing"];
const API = ["api"];
const APPS = [...API, ...UI];
const PARAMS = ["src/features/*/*-params.ts"];
const URL_PARAMS = [...PARAMS, "src/lib/**/*-params.ts"];
const ROUTES = ["src/app/**", "src/pages/**"];
const TESTS = ["**/*.test.ts", "**/*.test.tsx", "**/*.test-utils.ts", "e2e/*.test.ts"];
const OAUTH = "src/features/oauth/**";
const VIA = new Set(["window", "globalThis", "self"]);
const DRIVERS =
  /^(?:pg|postgres|mysql2|mariadb|redis|ioredis|mongodb|mongoose|better-sqlite3|kysely|drizzle-orm|bun:sqlite|node:sqlite|@prisma\/client|@neondatabase\/.+|@libsql\/.+|@planetscale\/.+|@upstash\/.+|@aws-sdk\/.+|@google-cloud\/.+)(?:\/.*)?$/;

const TABLE = [
  {
    ban: { react: ["useState"] },
    kinds: UI,
    use: "Use one useReducer with its reducer in <feature>-state.ts, or useActionState, useOptimistic, useTransition.",
  },
  {
    ban: { react: ["forwardRef"] },
    kinds: UI,
    use: "Take ref as a prop; React 19 passes it to function components.",
  },
  {
    ban: { react: ["useEffect", "useLayoutEffect", "useInsertionEffect"] },
    kinds: UI,
    owner: ["src/components/ui/**", "src/lib/notifications.ts"],
    use: "Derive the value while rendering, use a ref callback or a key reset, or wrap the library in components/ui.",
  },
  {
    ban: { react: ["useSyncExternalStore"] },
    kinds: UI,
    owner: ["src/lib/**"],
    use: "Put the store in src/lib/ and import its hook.",
  },
  {
    ban: { react: ["Suspense"] },
    kinds: ["web"],
    owner: ["src/components/boundary/section.tsx"],
    use: "Wrap the section in <Section fallback> from #/components/boundary/section.",
  },
  {
    ban: { module: /^@tanstack\/react-query$/, names: ["useQuery", "useInfiniteQuery", "useQueries"] },
    kinds: UI,
    use: "Read with useSuspenseQuery or useSuspenseInfiniteQuery.",
  },
  {
    ban: { module: /^@tanstack\/react-query(?:\/|$)/ },
    kinds: UI,
    owner: ["src/lib/query.ts"],
    use: "Import TanStack Query through #/lib/query.",
  },
  {
    ban: { module: /^#\/lib\/query$/, names: ["queryOptions", "infiniteQueryOptions"] },
    kinds: UI,
    owner: ["src/features/*/*-queries.ts"],
    use: "Define query keys and queryOptions in <feature>-queries.ts.",
  },
  {
    ban: { module: /^hono\/client$/ },
    kinds: UI,
    owner: ["src/lib/api/**"],
    use: "Call the API through the typed client in #/lib/api.",
  },
  {
    ban: { global: "fetch" },
    kinds: UI,
    owner: ["src/lib/api/**"],
    use: "Call the API through the typed client in #/lib/api.",
  },
  {
    ban: { literal: /^set-cookie$/i, method: ["getSetCookie"] },
    kinds: UI,
    owner: ["src/lib/api/**"],
    use: "Forward the API's Set-Cookie only in #/lib/api.",
  },
  {
    ban: { property: ["document", "cookie"] },
    kinds: UI,
    owner: ["src/lib/cookie.browser.ts"],
    use: "Read and write cookies through the helper in #/lib/cookie.browser.",
  },
  {
    ban: { global: "fetch" },
    kinds: API,
    owner: ["src/upstreams/**"],
    except: { in: TESTS, imports: /^express$/, localServer: true },
    use: "Call outside services through src/upstreams/<vendor>.ts with a timeout.",
  },
  {
    ban: { module: /^(?:ai|@ai-sdk\/[^/]+)(?:\/|$)/ },
    kinds: APPS,
    owner: ["src/lib/ai.ts"],
    use: "Call models through #/lib/ai.",
  },
  {
    ban: { module: /^(?:@base-ui-components|@base-ui|@rn-primitives|@ui-sdk)\// },
    kinds: UI,
    owner: ["src/components/ui/**"],
    use: "Use the primitives from #/components/ui.",
  },
  {
    ban: { property: ["process", "env"] },
    except: { env: true },
    kinds: APPS,
    owner: ["src/lib/env.ts", "src/env.ts", "*.config.*"],
    use: "Read env vars through #/lib/env.",
  },
  {
    ban: { meta: "env" },
    kinds: APPS,
    owner: ["src/lib/env.ts", "*.config.*"],
    use: "Read env vars through #/lib/env.",
  },
  {
    ban: { module: /^astro:env(?:\/|$)/ },
    kinds: ["marketing"],
    owner: ["src/lib/env.ts"],
    use: "Read env vars through #/lib/env.",
  },
  { ban: { global: "console" }, kinds: APPS, owner: ["src/lib/log.ts"], use: "Log through #/lib/log." },
  { ban: { global: "JSON" }, kinds: APPS, owner: ["src/lib/json.ts"], use: "Parse and serialise through #/lib/json." },
  { ban: { global: "Intl" }, kinds: APPS, owner: ["src/lib/format.ts"], use: "Format through #/lib/format." },
  {
    ban: { method: ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] },
    kinds: APPS,
    owner: ["src/lib/format.ts"],
    use: "Format through #/lib/format.",
  },
  {
    ban: { global: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] },
    kinds: APPS,
    owner: ["src/lib/timer.ts"],
    use: "Schedule through #/lib/timer.",
  },
  {
    ban: { global: "URLSearchParams" },
    kinds: UI,
    owner: URL_PARAMS,
    use: "Read search params in a *-params.ts module with parse().",
  },
  {
    ban: { property: [null, "searchParams"] },
    kinds: UI,
    owner: [...URL_PARAMS, "src/app/**/page.tsx"],
    use: "Pass searchParams to parse() from a *-params.ts module.",
  },
  {
    ban: { property: [null, "useSearch"] },
    kinds: ["liff"],
    owner: PARAMS,
    use: "Read search params in <feature>-params.ts.",
  },
  {
    ban: { module: /^@tanstack\/react-router$/, names: ["useSearch"] },
    kinds: ["liff"],
    owner: PARAMS,
    use: "Read search params in <feature>-params.ts.",
  },
  {
    ban: { module: /^expo-router$/, names: ["useLocalSearchParams", "useGlobalSearchParams"] },
    kinds: ["mobile"],
    owner: PARAMS,
    use: "Read params in <feature>-params.ts.",
  },
  {
    ban: { module: /^next\/navigation$/, names: ["useSearchParams"] },
    kinds: ["web"],
    owner: ["src/lib/next-route-params.ts"],
    use: "Parse searchParams on the server and pass props, or use src/lib/next-route-params.ts in a persistent layout.",
  },
  {
    ban: { property: ["router", "refresh"] },
    kinds: UI,
    use: "Update the cache in the Server Action with updateTag or refresh().",
  },
  {
    ban: { module: /^(?:expo-router|@react-navigation\/native)$/, names: ["useFocusEffect"] },
    kinds: ["mobile"],
    use: "Let TanStack Query refetch on focus.",
  },
  {
    ban: { module: /^react-native$/, names: ["SafeAreaView"] },
    kinds: ["mobile"],
    use: "Import SafeAreaView from react-native-safe-area-context.",
  },
  { ban: { property: ["Keyboard", "addListener"] }, kinds: ["mobile"], use: "Use react-native-keyboard-controller." },
  { ban: { property: ["StyleSheet", "create"] }, kinds: ["mobile"], use: "Style with Uniwind classes." },
  {
    ban: { module: /^next\/headers$/ },
    kinds: ["web"],
    in: ROUTES,
    use: "Read session and data in a feature component inside <Section>.",
  },
  {
    ban: { module: /^#\/lib\/api(?:\/|$)|\.server$/ },
    except: { module: /^#\/lib\/i18n\.server(?:\.ts)?$/ },
    kinds: UI,
    in: ROUTES,
    owner: ["src/app/**/route.ts"],
    use: "Import a feature component that loads its own data.",
  },
  {
    ban: { module: /^#\/features\// },
    kinds: APPS,
    in: ["src/lib/**", "src/components/**"],
    use: "Compose features in routes; lib and components stay feature-free.",
  },
  {
    ban: { module: /^hono(?:\/tiny|\/quick)?$/, names: ["Hono"] },
    kinds: API,
    owner: ["src/factory.ts"],
    use: "Build routers with factory.createApp() from #/factory.",
  },
  { ban: { module: /^hono\/factory$/ }, kinds: API, owner: ["src/factory.ts"], use: "Import factory from #/factory." },
  {
    ban: { module: /^(?:hono\/validator|@hono\/[a-z-]+-validator)$/ },
    kinds: API,
    owner: ["src/lib/validate.ts"],
    use: "Validate input with v() from #/lib/validate.",
  },
  {
    ban: { module: /^hono-openapi$/, names: ["validator"] },
    kinds: API,
    owner: ["src/lib/validate.ts"],
    use: "Validate input with v() from #/lib/validate.",
  },
  {
    ban: { module: DRIVERS },
    kinds: API,
    owner: ["src/features/*/db.ts", "src/infra/**"],
    use: "Query through the feature's db.ts.",
  },
  {
    ban: { property: [null, "onError"] },
    kinds: API,
    owner: ["src/app.ts", OAUTH],
    use: "Throw ApiError; src/app.ts maps errors through lib/errors.ts.",
  },
  {
    ban: { property: [null, "notFound"] },
    kinds: API,
    owner: ["src/app.ts", OAUTH],
    use: 'Throw ApiError("not_found").',
  },
  {
    ban: { property: [null, "put"] },
    kinds: API,
    in: ["src/features/*/routes.ts"],
    use: "Use PATCH /:id with a partial body.",
  },
  {
    ban: { export: ["publicRoutes", "PUBLIC_ROUTES", "publicPaths"] },
    kinds: API,
    owner: ["src/middleware/public-routes.ts"],
    use: "List public routes in src/middleware/public-routes.ts.",
  },
  {
    ban: { property: ["app", "request"] },
    kinds: API,
    in: TESTS,
    except: { path: /^\/(?!api(?:\/|$))/ },
    use: "Call routes through testClient().",
  },
  { ban: { property: ["expect", "poll"] }, in: TESTS, use: "Await the real event instead of polling." },
  { ban: { property: ["jest", "setTimeout"] }, in: TESTS, use: "Make the test fast instead of raising its timeout." },
  {
    ban: { module: /^@testing-library\/react(?:-native)?$/, names: ["waitFor", "waitForElementToBeRemoved"] },
    in: TESTS,
    use: "Await findBy* queries or advance fake timers.",
  },
];

const matches = (local, globs) => globs.some((glob) => matchesGlob(local, glob));
const list = (value) => (Array.isArray(value) ? value : [value]);

function subjects(local) {
  const tested = testedStem(local);
  return tested ? [local, `${tested}.ts`, `${tested}.tsx`] : [local];
}

function applies(entry, where) {
  if (entry.kinds && !entry.kinds.includes(where.kind)) return false;
  if (entry.in && !matches(where.local, entry.in)) return false;
  return !subjects(where.local).some((local) => matches(local, entry.owner ?? []));
}

function firstPath(node) {
  const call = node.parent;
  const arg = call?.type === "CallExpression" && call.callee === node ? call.arguments[0] : null;
  if (arg?.type === "Literal" && typeof arg.value === "string") return arg.value;
  if (arg?.type === "TemplateLiteral" && arg.expressions.length === 0) return arg.quasis[0].value.cooked;
  return null;
}

function importBinding(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable.defs[0]?.type === "ImportBinding";
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Owner files are the only users of the globals, modules and hooks they own." },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where?.base) return {};
    const rules = TABLE.filter((entry) => applies(entry, where));
    if (rules.length === 0) return {};
    const sources = [];
    let localServer = false;
    const pending = [];
    const report = (node, entry) => pending.push({ node, entry });
    const excepted = ({ node, entry }) => {
      const rule = entry.except;
      if (!rule) return false;
      if (rule.module) return rule.module.test(node.source?.value ?? "");
      if (rule.env) {
        const parent = node.parent;
        return (
          (where.kind === "web" &&
            where.local === "src/instrumentation.ts" &&
            parent?.type === "MemberExpression" &&
            !parent.computed &&
            parent.property.name === "NEXT_RUNTIME") ||
          (/\.(?:test-utils|fixture)\.[cm]?[jt]sx?$/.test(where.name) &&
            parent?.type === "SpreadElement" &&
            parent.parent?.type === "ObjectExpression")
        );
      }
      if (rule.localServer && localServer && isTestSupport(where.name)) return true;
      if (rule.in && !matches(where.local, rule.in)) return false;
      if (rule.imports && !sources.some((source) => rule.imports.test(source))) return false;
      return !rule.path || rule.path.test(firstPath(node) ?? "");
    };
    const globals = new Map(
      rules.flatMap((entry) => (entry.ban.global ? list(entry.ban.global).map((name) => [name, entry]) : [])),
    );
    const hooks = new Map(rules.flatMap((entry) => (entry.ban.react ?? []).map((name) => [name, entry])));
    const property = (object, name) =>
      rules.find(
        (entry) =>
          entry.ban.property &&
          entry.ban.property[1] === name &&
          (entry.ban.property[0] === null || entry.ban.property[0] === object),
      );
    const namespaces = new Set();
    const modules = moduleVisitors((source, node, specifiers) => {
      sources.push(source);
      if (source === "react")
        for (const specifier of specifiers)
          if (specifier.type === "ImportNamespaceSpecifier" || specifier.type === "ImportDefaultSpecifier")
            namespaces.add(specifier.local.name);
      for (const entry of rules) {
        if (source === "react" && entry.ban.react) {
          for (const specifier of specifiers)
            if (entry.ban.react.includes(importedName(specifier))) report(specifier, entry);
        }
        if (!entry.ban.module?.test(source)) continue;
        if (!entry.ban.names) report(node, entry);
        else
          for (const specifier of specifiers)
            if (entry.ban.names.includes(importedName(specifier))) report(specifier, entry);
      }
    });
    return {
      ...modules,
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.property.name === "listen" &&
          typeof node.arguments[0]?.value === "number"
        )
          localServer = true;
      },
      MemberExpression(node) {
        if (node.computed) return;
        const name = node.property.name;
        const object = node.object.type === "Identifier" ? node.object.name : null;
        if (namespaces.has(object) && hooks.has(name) && importBinding(context.sourceCode.getScope(node), object))
          report(node, hooks.get(name));
        if (object && VIA.has(object) && globals.has(name)) report(node, globals.get(name));
        if (node.object.type === "MetaProperty" && name === "env") {
          const entry = rules.find((candidate) => candidate.ban.meta === "env");
          if (entry) report(node, entry);
        }
        const factoryApp =
          node.object.type === "CallExpression" &&
          node.object.callee.type === "Identifier" &&
          node.object.callee.name === "createApp";
        const banned = property(factoryApp && name === "request" ? "app" : object, name);
        if (banned) report(node, banned);
        if (node.parent?.type === "CallExpression" && node.parent.callee === node) {
          const entry = rules.find((candidate) => candidate.ban.method?.includes(name));
          if (entry) report(node, entry);
        }
      },
      JSXMemberExpression(node) {
        const object = node.object.type === "JSXIdentifier" ? node.object.name : null;
        const name = node.property.name;
        if (namespaces.has(object) && hooks.has(name) && importBinding(context.sourceCode.getScope(node), object))
          report(node, hooks.get(name));
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        const call = node.parent;
        if (
          call?.type === "CallExpression" &&
          call.callee.type === "MemberExpression" &&
          call.callee.property.name === "has"
        )
          return;
        const entry = rules.find((candidate) => candidate.ban.literal?.test(node.value));
        if (entry) report(node, entry);
      },
      ExportNamedDeclaration(node) {
        modules.ExportNamedDeclaration(node);
        const names = exportedIds(node).map((id) => id.name ?? id.value);
        for (const entry of rules)
          if (entry.ban.export && names.some((name) => entry.ban.export.includes(name))) report(node, entry);
      },
      "Program:exit"(program) {
        if (globals.size > 0)
          for (const reference of context.sourceCode.getScope(program).through) {
            const entry = globals.get(reference.identifier.name);
            if (entry) report(reference.identifier, entry);
          }
        for (const item of pending) if (!excepted(item)) context.report({ node: item.node, message: item.entry.use });
      },
    };
  },
};
