import { writeFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";

const UI = ["web", "liff", "mobile", "marketing"];
const ALL = ["api", ...UI];
const PARAMS = "src/features/*/*-params.ts";
const TESTS = ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"];
const ROUTES = { "*": ["src/app/**"], marketing: ["src/pages/**"] };
const SHARED = ["src/lib/**", "src/components/**"];

const hook = (name, message) => ({ name: "react", importNames: [name], message });
const owned = (thing, owner) => `${thing} belongs to ${owner}. Use it through that file.`;

const ENTRIES = [
  {
    apps: UI,
    imports: hook(
      "useState",
      "No useState. Use one useReducer with its reducer in <feature>-state.ts, or useActionState, useOptimistic, useTransition.",
    ),
  },
  {
    apps: UI,
    exempt: { "*": ["src/components/ui/**"], mobile: ["src/components/ui/**", "src/lib/notifications.ts"] },
    imports: {
      name: "react",
      importNames: ["useEffect", "useLayoutEffect", "useInsertionEffect"],
      message:
        "No effects. Derive while rendering, use ref callbacks or key resets, or wrap the library in components/ui.",
    },
  },
  {
    apps: UI,
    exempt: ["src/lib/**"],
    imports: hook("useSyncExternalStore", owned("useSyncExternalStore", "src/lib/")),
  },
  {
    apps: ["web"],
    exempt: ["src/components/boundary/section.tsx"],
    imports: hook("Suspense", "Use <Section fallback> from components/boundary/section.tsx."),
  },
  {
    apps: UI,
    imports: {
      name: "@tanstack/react-query",
      importNames: ["useQuery", "useInfiniteQuery", "useQueries"],
      message: "Read with useSuspenseQuery or useSuspenseInfiniteQuery.",
    },
  },
  {
    apps: UI,
    exempt: ["src/lib/query.ts"],
    patterns: { regex: "^@tanstack/react-query(/|$)", message: owned("@tanstack/react-query", "src/lib/query.ts") },
  },
  {
    apps: UI,
    exempt: ["src/features/*/*-queries.ts"],
    imports: {
      name: "@/lib/query",
      importNames: ["queryOptions", "infiniteQueryOptions"],
      message: "Query keys and queryOptions live in <feature>-queries.ts.",
    },
  },
  {
    apps: UI,
    exempt: ["src/lib/api/**"],
    imports: { name: "hono/client", message: owned("The Hono client", "src/lib/api/") },
  },
  {
    apps: ALL,
    exempt: ["src/lib/ai.ts"],
    patterns: { regex: "^(ai|@ai-sdk/[^/]+)(/|$)", message: owned("The AI SDK", "src/lib/ai.ts") },
  },
  {
    apps: UI,
    exempt: ["src/components/ui/**"],
    patterns: {
      regex: "^(@base-ui-components|@base-ui|@rn-primitives)/",
      message: owned("UI primitives", "src/components/ui/"),
    },
  },
  {
    apps: ["marketing"],
    exempt: ["src/lib/env.ts"],
    patterns: { regex: "^astro:env(/|$)", message: owned("Environment variables", "src/lib/env.ts") },
  },
  {
    apps: ["web"],
    imports: {
      name: "next/navigation",
      importNames: ["useSearchParams"],
      message: "Parse searchParams on the server with <feature>-params.ts and pass props.",
    },
  },
  {
    apps: ["mobile"],
    exempt: [PARAMS],
    imports: {
      name: "expo-router",
      importNames: ["useLocalSearchParams", "useGlobalSearchParams"],
      message: "Only <feature>-params.ts reads params.",
    },
  },
  {
    apps: ["liff"],
    exempt: [PARAMS],
    imports: {
      name: "@tanstack/react-router",
      importNames: ["useSearch"],
      message: "Only <feature>-params.ts reads search params.",
    },
  },
  {
    apps: ["mobile"],
    imports: {
      name: "expo-router",
      importNames: ["useFocusEffect"],
      message: "No useFocusEffect. Let TanStack Query refetch on focus.",
    },
  },
  {
    apps: ["mobile"],
    imports: {
      name: "@react-navigation/native",
      importNames: ["useFocusEffect"],
      message: "No useFocusEffect. Let TanStack Query refetch on focus.",
    },
  },
  {
    apps: ["mobile"],
    imports: { name: "react-native", importNames: ["SafeAreaView"], message: "Use react-native-safe-area-context." },
  },
  {
    apps: ["api"],
    exempt: ["src/factory.ts"],
    imports: {
      name: "hono",
      importNames: ["Hono"],
      message: "Build routers with factory.createApp() from src/factory.ts.",
    },
  },
  {
    apps: ["api"],
    exempt: ["src/factory.ts"],
    imports: { name: "hono/factory", message: owned("createFactory", "src/factory.ts") },
  },
  {
    apps: ["api"],
    exempt: ["src/lib/validate.ts"],
    patterns: {
      regex: "^(hono/validator|@hono/[a-z-]+-validator)$",
      message: "Validate input with v() from @/lib/validate.",
    },
  },
  {
    apps: ["api"],
    exempt: ["src/lib/validate.ts"],
    imports: {
      name: "hono-openapi",
      importNames: ["validator"],
      message: "Validate input with v() from @/lib/validate.",
    },
  },
  {
    apps: ["api"],
    exempt: ["src/features/*/db.ts", "src/infra/**"],
    patterns: {
      regex:
        "^(pg|postgres|mysql2|mariadb|redis|ioredis|mongodb|mongoose|better-sqlite3|kysely|drizzle-orm|bun:sqlite|node:sqlite|@prisma/client|@neondatabase/.+|@libsql/.+|@planetscale/.+|@upstash/.+|@aws-sdk/.+|@google-cloud/.+)(/|$)",
      message: "Only a feature db.ts and src/infra/ touch drivers.",
    },
  },
  {
    apps: ["web"],
    only: ROUTES,
    imports: { name: "next/headers", message: "Route files never read session or data." },
  },
  {
    apps: UI,
    only: ROUTES,
    patterns: {
      regex: "(^@/lib/api(/|$))|(\\.server$)",
      message: "Route files never import data modules. Load data in a feature component.",
    },
  },
  {
    apps: ALL,
    only: SHARED,
    patterns: {
      regex: "^@/features/",
      message: "lib/ and components/ never import features. Features meet in routes.",
    },
  },
  { apps: ALL, exempt: ["src/lib/log.ts"], globals: { name: "console", message: owned("console", "src/lib/log.ts") } },
  { apps: ALL, exempt: ["src/lib/json.ts"], globals: { name: "JSON", message: owned("JSON", "src/lib/json.ts") } },
  { apps: ALL, exempt: ["src/lib/format.ts"], globals: { name: "Intl", message: owned("Intl", "src/lib/format.ts") } },
  ...["setTimeout", "setInterval", "clearTimeout", "clearInterval"].map((name) => ({
    apps: ALL,
    exempt: ["src/lib/timer.ts"],
    globals: { name, message: owned("Timers", "src/lib/timer.ts") },
  })),
  {
    apps: ALL,
    exempt: { "*": ["src/lib/api/**"], api: ["src/upstreams/**"] },
    globals: { name: "fetch", message: "Only src/lib/api/ (UI apps) and src/upstreams/ (API) call fetch." },
  },
  {
    apps: UI,
    exempt: [PARAMS],
    globals: { name: "URLSearchParams", message: "Only <feature>-params.ts reads search params." },
  },
  ...["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].map((property) => ({
    apps: ALL,
    exempt: ["src/lib/format.ts"],
    properties: { property, message: owned("Locale formatting", "src/lib/format.ts") },
  })),
  {
    apps: ALL,
    exempt: { "*": ["src/lib/env.ts", "*.config.*"], api: ["src/env.ts", "src/lib/env.ts", "*.config.*"] },
    properties: { object: "process", property: "env", message: owned("Environment variables", "src/lib/env.ts") },
  },
  {
    apps: UI,
    properties: {
      object: "router",
      property: "refresh",
      message: "Never router.refresh(). Update the cache in the Server Action with updateTag or refresh().",
    },
  },
  {
    apps: UI,
    exempt: { "*": [PARAMS], web: [PARAMS, "src/app/**/page.tsx"] },
    properties: { property: "searchParams", message: "Only <feature>-params.ts reads search params." },
  },
  {
    apps: ["liff"],
    exempt: [PARAMS],
    properties: { property: "useSearch", message: "Only <feature>-params.ts reads search params." },
  },
  {
    apps: ["mobile"],
    properties: { object: "Keyboard", property: "addListener", message: "Use react-native-keyboard-controller." },
  },
  {
    apps: ["mobile"],
    properties: { object: "StyleSheet", property: "create", message: "Style with Uniwind classes." },
  },
  {
    apps: ["api"],
    only: ["src/features/*/routes.ts"],
    properties: { property: "put", message: "No PUT routes. Use PATCH /:id." },
  },
  ...["onError", "notFound"].map((property) => ({
    apps: ["api"],
    exempt: ["src/app.ts"],
    properties: {
      property,
      message: "onError and notFound are set only in src/app.ts; the mapping lives in lib/errors.ts.",
    },
  })),
  {
    apps: ["api"],
    exempt: ["src/middleware/public-routes.ts"],
    exports: ["publicRoutes", "PUBLIC_ROUTES", "publicPaths"],
  },
  {
    apps: ["api"],
    only: TESTS,
    properties: { object: "app", property: "request", message: "Call routes in tests through testClient()." },
  },
];

const TEST_ENTRIES = [
  { properties: { object: "expect", property: "poll", message: "No polling in tests. Await the real event." } },
  { properties: { object: "jest", property: "setTimeout", message: "No per-test timeouts." } },
  ...["@testing-library/react", "@testing-library/react-native"].map((name) => ({
    imports: {
      name,
      importNames: ["waitFor", "waitForElementToBeRemoved"],
      message: "No polling in tests. Await the real event with findBy* or fake timers.",
    },
  })),
];

const VIA_GLOBAL = ["window", "globalThis"];

const RELATIVE = { regex: "^\\.{1,2}(/|$)", message: "Import through the @/ alias." };

const COMPILER = [
  "rules-of-hooks",
  "purity",
  "immutability",
  "refs",
  "globals",
  "set-state-in-render",
  "static-components",
  "use-memo",
  "void-use-memo",
  "preserve-manual-memoization",
  "incompatible-library",
  "unsupported-syntax",
  "error-boundaries",
];

const PLUGIN_RULES = {
  api: ["feature-imports", "hono", "import-meta-env"],
  web: ["feature-imports", "reducer", "next-routes", "next-data", "server-actions", "params", "import-meta-env"],
  liff: ["feature-imports", "reducer", "next-data", "params", "import-meta-env"],
  mobile: ["feature-imports", "reducer", "next-data", "params", "import-meta-env"],
  marketing: ["feature-imports", "reducer", "params", "import-meta-env"],
};

function onlyFor(entry, app) {
  if (!entry.only) return null;
  if (Array.isArray(entry.only)) return entry.only;
  return entry.only[app] ?? entry.only["*"];
}

function exemptFor(entry, app) {
  if (!entry.exempt) return [];
  if (Array.isArray(entry.exempt)) return entry.exempt;
  return entry.exempt[app] ?? entry.exempt["*"];
}

function covers(glob, patterns) {
  return patterns.some((pattern) => pattern === glob || matchesGlob(glob, pattern));
}

function restrictions(entries) {
  const rules = {};
  const imports = entries.filter((entry) => entry.imports).map((entry) => entry.imports);
  const patterns = entries.filter((entry) => entry.patterns).map((entry) => entry.patterns);
  rules["no-restricted-imports"] = ["error", { paths: imports, patterns: [RELATIVE, ...patterns] }];
  const globals = entries.filter((entry) => entry.globals).map((entry) => entry.globals);
  rules["no-restricted-globals"] = globals.length ? ["error", ...globals] : "off";
  const properties = entries.flatMap((entry) => [
    ...(entry.properties ? [entry.properties] : []),
    ...(entry.globals
      ? VIA_GLOBAL.map((object) => ({ object, property: entry.globals.name, message: entry.globals.message }))
      : []),
    ...(entry.imports?.name === "react"
      ? entry.imports.importNames.map((property) => ({ object: "React", property, message: entry.imports.message }))
      : []),
  ]);
  rules["no-restricted-properties"] = properties.length ? ["error", ...properties] : "off";
  const exports = entries.flatMap((entry) => entry.exports ?? []);
  rules["no-restricted-exports"] = exports.length ? ["error", { restrictedNamedExports: exports }] : "off";
  return rules;
}

function reactRules(dom) {
  const rules = Object.fromEntries(COMPILER.map((rule) => [`react/${rule}`, "error"]));
  rules["react/jsx-no-literals"] = ["error", { restrictedAttributes: ["placeholder", "aria-label", "title", "alt"] }];
  rules["react/forbid-component-props"] = ["error", { forbid: ["style"] }];
  if (dom) rules["react/forbid-dom-props"] = ["error", { forbid: ["style"] }];
  return rules;
}

function appOverrides(app) {
  const entries = ENTRIES.filter((entry) => entry.apps.includes(app));
  const prefix = (glob) => `apps/${app}/${glob}`;
  const pick = (glob) =>
    entries.filter(
      (entry) => (!entry.only || covers(glob, onlyFor(entry, app))) && !covers(glob, exemptFor(entry, app)),
    );
  const globs = [
    ...new Set(entries.flatMap((entry) => [...exemptFor(entry, app), ...(onlyFor(entry, app) ?? [])])),
  ].filter((glob) => !TESTS.includes(glob));
  globs.sort((a, b) => Number(b.includes("**")) - Number(a.includes("**")) || a.length - b.length);
  const plugins =
    app === "api"
      ? []
      : app === "web"
        ? ["react", "jsx-a11y", "nextjs"]
        : app === "mobile"
          ? ["react"]
          : ["react", "jsx-a11y"];
  const rules = {
    ...(app === "api" ? {} : reactRules(app !== "mobile")),
    ...Object.fromEntries(PLUGIN_RULES[app].map((rule) => [`standard/${rule}`, "error"])),
    ...restrictions(entries.filter((entry) => !entry.only)),
  };
  const base = { files: [prefix("**")], ...(plugins.length ? { plugins } : {}), rules };
  const changed = (next) =>
    Object.fromEntries(
      Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(rules[key])),
    );
  const specific = globs.map((glob) => ({ files: [prefix(glob)], rules: changed(restrictions(pick(glob))) }));
  const tests = {
    files: TESTS.map(prefix),
    rules: changed(restrictions([...entries.filter((entry) => !entry.only || entry.only === TESTS), ...TEST_ENTRIES])),
  };
  return [base, ...specific, tests];
}

export function config() {
  return {
    $schema: "./node_modules/oxlint/configuration_schema.json",
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest"],
    jsPlugins: ["./src/plugin/index.mjs"],
    categories: { correctness: "error" },
    options: { typeAware: true, typeCheck: true },
    env: { builtin: true, es2024: true },
    rules: {
      "standard/no-comments": "error",
      "standard/no-chained-assertions": "error",
      "standard/no-typeof": "error",
      "standard/repo-shape": "error",
      "typescript/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: false }],
      "unicorn/filename-case": [
        "error",
        { case: "kebabCase", ignore: ["^_layout\\.", "^__root\\.", "^\\+", "^\\[", "^\\$", "\\.d\\.ts$"] },
      ],
      "oxc/no-barrel-file": "error",
      "import/no-cycle": "error",
      "import/no-default-export": "error",
      "no-restricted-imports": ["error", { patterns: [RELATIVE] }],
    },
    overrides: [
      ...ALL.flatMap(appOverrides),
      { files: TESTS.map((glob) => `packages/${glob}`), rules: restrictions(TEST_ENTRIES) },
      {
        files: ["apps/web/src/app/**", "apps/mobile/src/app/**", "apps/marketing/src/pages/**", "**/*.config.*"],
        rules: { "import/no-default-export": "off" },
      },
      {
        files: TESTS,
        rules: {
          "standard/tests": "error",
          "vitest/no-focused-tests": "error",
          "vitest/no-disabled-tests": "error",
          "vitest/no-restricted-matchers": [
            "error",
            Object.fromEntries(
              [
                "toMatchSnapshot",
                "toMatchInlineSnapshot",
                "toMatchFileSnapshot",
                "toThrowErrorMatchingSnapshot",
                "toThrowErrorMatchingInlineSnapshot",
              ].map((matcher) => [matcher, "No snapshot assertions. Assert the specific outcome."]),
            ),
          ],
          "vitest/no-restricted-vi-methods": [
            "error",
            {
              waitFor: "No polling in tests. Await the real event.",
              waitUntil: "No polling in tests. Await the real event.",
              setConfig: "No per-test timeouts.",
            },
          ],
        },
      },
      { files: ["**/vitest.config.*", "**/vite.config.*", "**/jest.config.*"], rules: { "standard/tests": "error" } },
    ],
  };
}

export function render(value) {
  const { overrides, ...rest } = value;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  return `${head},\n  "overrides": [\n${overrides.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]\n}\n`;
}

if (import.meta.main) writeFileSync(join(import.meta.dirname, "../oxlint.json"), render(config()));
