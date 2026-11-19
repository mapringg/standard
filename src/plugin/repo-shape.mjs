import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DATABASE_SUITE,
  UI_APPS,
  anchorFor,
  describe,
  exportedIds,
  isGenerated,
  isTest,
  isTestSupport,
  listFiles,
  locate,
  stem,
} from "./paths.mjs";

const PACKAGES = new Set(["tokens", "i18n"]);
const TOP_DIRS = new Set(["apps", "packages", "infra", "scripts", ".github", ".githooks", ".claude", ".vscode", ".amp"]);
const CHECK_SCRIPT = /(?:^|[-.])(?:check|lint|verify|validate|audit|enforce)(?:[-.]|$)/;
const DOCS = new Set(["README.md", "AGENTS.md"]);
const CODE = /\.[cm]?[jt]sx?$/;
const DIRECTIVE = /(?:\/\/|\/\*)\s*(?:eslint|oxlint)-(?:disable|enable)/;
const NEXT_FILES = new Set([
  "page",
  "layout",
  "error",
  "global-error",
  "not-found",
  "global-not-found",
  "template",
  "forbidden",
  "unauthorized",
  "route",
  "sitemap",
  "robots",
  "manifest",
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
]);
const API_FEATURE_FILES = new Set(["routes", "schema", "db", "service"]);
const API_ROOT_FILES = new Set(["app.ts", "factory.ts", "env.ts", "server.ts", "client.ts"]);
const API_DIRS = new Set(["middleware", "infra", "upstreams"]);
const WEB_ROOT_FILES = new Set(["proxy", "instrumentation", "instrumentation-client"]);
const SSE = /text\/event-stream|\.to\w*StreamResponse\(/;
const CACHE_MS = 2000;
const scans = new Map();

function routesDir(kind) {
  return kind === "marketing" ? "pages" : "app";
}

const HANDLER_MESSAGE =
  "Move the handler into a webhooks/ folder, a metadata route like sitemap.xml/route.ts or a Server Action; keep only GET at src/app/health/route.ts, MCP at src/app/mcp/route.ts, or streaming or cancellable handlers under src/app/api/ with text/event-stream or a value import from <feature>-stream.server.ts or <feature>-cancellable.server.ts.";

function handlerAllowed(where, program, text) {
  const segments = where.local.split("/").slice(2, -1);
  if (segments.includes("webhooks") || segments.at(-1)?.includes(".")) return true;
  if (where.local === "src/app/mcp/route.ts") return true;
  if (where.local === "src/app/health/route.ts") {
    const exports = program.body.filter((node) => node.type.startsWith("Export"));
    return (
      exports.length > 0 &&
      exports.every(
        (node) =>
          node.type === "ExportNamedDeclaration" &&
          node.exportKind !== "type" &&
          !node.declaration?.type.startsWith("TS") &&
          node.specifiers.every((specifier) => specifier.exportKind !== "type") &&
          exportedIds(node).length > 0 &&
          exportedIds(node).every((id) => (id.name ?? id.value) === "GET"),
      )
    );
  }
  return (
    segments[0] === "api" &&
    (SSE.test(text) ||
      program.body.some(
        (node) =>
          node.type === "ImportDeclaration" &&
          node.importKind !== "type" &&
          node.specifiers.some((specifier) => specifier.importKind !== "type") &&
          /(?:^|\/)[^/]+-(?:stream|cancellable)\.server(?:\.ts)?$/.test(node.source.value),
      ))
  );
}

function webRoute(rest, name) {
  const segments = rest.split("/").slice(1, -1);
  const found = [];
  for (const segment of segments) {
    if (segment.startsWith("@")) found.push("Compose the sections inside one page instead of a parallel route.");
    if (/^\(\.{1,3}\)/.test(segment)) found.push("Link to the real route instead of intercepting it.");
    if (segment.startsWith("_")) found.push("Move the code from the _private folder into a feature or components/.");
  }
  const file = stem(name);
  if (file === "loading")
    found.push(
      "Delete loading.tsx and wrap the slow section in <Section fallback> from #/components/boundary/section.",
    );
  else if (file === "default") found.push("Delete default.tsx and compose the sections inside one page.");
  else if (!NEXT_FILES.has(file))
    found.push("Move this code into a feature or components/; app/ holds only Next route files.");
  return found;
}

function astroText(text) {
  let rest = text
    .replace(/^---[\s\S]*?---/, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  for (let previous = ""; previous !== rest;) {
    previous = rest;
    rest = rest.replace(/\{[^{}]*\}/g, "");
  }
  return /\p{L}/u.test(rest.replace(/<[^>]*>/g, ""));
}

function codeProblems(where) {
  const { kind, pkg, local, name, feature } = where;
  if (isGenerated(name)) return [];
  if (local.startsWith("e2e/")) {
    return local.split("/").length === 2 && isTestSupport(name)
      ? []
      : ["Move the journey to apps/<app>/e2e/<journey>.test.ts."];
  }
  if (kind === "api" && local.startsWith("migrations/")) return [];
  if (!local.includes("/"))
    return /\.config\./.test(name)
      ? []
      : [`${kind ? "App" : "Package"} root holds config only. Move this code into src/.`];
  if (!local.startsWith("src/")) return ["Move the code into src/."];
  if (pkg) return [];
  const rest = local.slice(4);
  const parts = rest.split("/");
  const found = [];
  const apiPlaced =
    kind === "api" &&
    ((parts.length === 1 && API_ROOT_FILES.has(name.replace(/\.(?:test|fixture|test-utils)\.ts$/, ".ts"))) ||
      (parts.length === 2 && API_DIRS.has(parts[0])));
  if (isTestSupport(name) && !apiPlaced && !["features", "lib", "components"].includes(parts[0])) {
    found.push(
      parts[0] === routesDir(kind)
        ? "Move the test to the feature code it covers; route files never have tests."
        : kind === "api"
          ? "Move the test next to the code it tests in features/, lib/, middleware/, infra/, upstreams/ or beside app.ts, factory.ts, env.ts, server.ts or client.ts."
          : "Move the test next to the code it tests in features/, lib/ or components/.",
    );
  }
  if (parts[0] === "features") {
    if (parts.length !== 3) return [...found, "Flatten the feature folder, or split a big feature into two features."];
    const base = stem(name).split(".")[0];
    if (kind === "api") {
      if (!API_FEATURE_FILES.has(base))
        found.push("Move the code into the feature's routes.ts, schema.ts, db.ts or service.ts.");
    } else if (base !== feature && !base.startsWith(`${feature}-`)) {
      found.push(`Rename the file to ${feature}-${base} so it starts with its feature.`);
    }
    return found;
  }
  if (parts[0] === "lib") return found;
  if (kind === "api") {
    if (apiPlaced) return found;
    return [
      ...found,
      "Move the code into app.ts, factory.ts, env.ts, server.ts, client.ts, middleware/, lib/, infra/, upstreams/ or features/<resource>/.",
    ];
  }
  if (parts[0] === "components") {
    return parts.length === 3 ? found : [...found, "Move the component to components/<group>/<file>, one level deep."];
  }
  if (parts[0] === routesDir(kind)) return kind === "web" ? [...found, ...webRoute(rest, name)] : found;
  if (parts.length === 1) {
    if (kind === "web" && WEB_ROOT_FILES.has(stem(name))) return found;
    if (kind === "liff" && name === "main.tsx") return found;
    if (kind === "marketing" && stem(name) === "content.config") return found;
  }
  if (kind === "marketing" && parts[0] === "content") return found;
  return [...found, `Move the code into src/${routesDir(kind)}/, src/features/, src/components/ or src/lib/.`];
}

function fileProblems(rel, root, localized) {
  const where = describe(rel, root);
  const parts = rel.split("/");
  const { name, kind, pkg, base, local } = where;
  const found = [];
  if (parts.length > 1 && !TOP_DIRS.has(parts[0]))
    return ["Move this into apps/ or packages/; the top level holds only config."];
  if (parts[0] === "apps" && parts.length > 2 && !kind)
    return [
      "Add hono, next, vite, expo or astro to the app's package.json dependencies so the standard knows its kind.",
    ];
  if (parts[0] === "packages" && parts.length > 2 && !PACKAGES.has(pkg))
    return [`Move this into an app's lib/; packages/ holds only ${[...PACKAGES].join(" and ")}.`];
  if (/\.mdx?$/.test(name)) {
    const exempt = rel.startsWith(".claude/skills/") || (kind === "marketing" && local.startsWith("src/content/"));
    const placed = DOCS.has(name) && (parts.length === 1 || (base && local === name));
    if (!exempt && !placed) found.push("Fold this into README.md or AGENTS.md, or delete it.");
  }
  if (/\.(?:scss|sass|less|styl)$/.test(name))
    found.push("Replace the preprocessor file with Tailwind classes and the one global CSS file.");
  if (name.endsWith(".module.css")) found.push("Replace the CSS module with Tailwind classes.");
  if (name.endsWith(".css") && !base) found.push("Move the CSS into the app's one global CSS file.");
  if (name.endsWith(".astro")) {
    if (kind !== "marketing" || !local.startsWith("src/") || local.startsWith("src/lib/"))
      found.push("Write this component as .tsx; .astro files live only in the marketing app's routes and components.");
    else if (astroText(readFileSync(join(root, rel), "utf8")))
      found.push("Move the text into a content collection entry or pass it as a prop.");
  }
  if (parts[0] === "scripts" && CHECK_SCRIPT.test(name))
    found.push("Delete the check script and add the check to the standard; scripts/ holds operational tools.");
  if (/\.spec\.[cm]?[jt]sx?$/.test(name)) found.push("Rename the test to *.test.ts or *.test.tsx.");
  if (
    CODE.test(name) &&
    /^(?:(?:.*[-.])?(?:helpers?|mocks?|stubs?|fakes?|test-?utils)|(?:(?:vi)?test[-.]|jest[-.])?setup)\.[cm]?[jt]sx?$/.test(
      name,
    ) &&
    !/\.test-utils\.[cm]?[jt]sx?$/.test(name)
  ) {
    found.push("Rename the file to <name>.fixture.ts or <name>.test-utils.ts.");
  }
  if (
    kind &&
    UI_APPS.has(kind) &&
    /(?:^|\/)(?:i18n|messages)\//.test(local) &&
    !local.startsWith(`src/${routesDir(kind)}/`) &&
    !/^src\/lib\/i18n\/messages\/[a-z0-9-]+\.ts$/.test(local)
  ) {
    found.push("Move the dictionary to src/lib/i18n/messages/<feature>.ts.");
  }
  if (
    kind === "marketing" &&
    localized?.has(base) &&
    local.startsWith("src/pages/") &&
    !local.startsWith("src/pages/[locale]/")
  ) {
    found.push("Move the page under src/pages/[locale]/.");
  }
  if (parts.length === 1 && CODE.test(name) && !/\.config\./.test(name))
    found.push("Move this code into an app or package; the top level holds only config.");
  if (base && CODE.test(name)) found.push(...codeProblems(where));
  return found;
}

function scan(root) {
  const files = listFiles(root);
  const localized = new Set(
    files
      .filter((rel) => /^apps\/[^/]+\/src\/pages\/\[locale\]\//.test(rel))
      .map((rel) => rel.split("/").slice(0, 2).join("/")),
  );
  const lintable = files.filter((rel) => CODE.test(rel));
  const findings = new Map();
  const add = (anchor, message) => {
    if (!anchor) return;
    if (!findings.has(anchor)) findings.set(anchor, []);
    findings.get(anchor).push(message);
  };
  const css = new Map();
  const bases = new Set();
  const groups = new Set();
  const directives = [];
  for (const rel of files) {
    const where = describe(rel, root);
    if (where.kind) bases.add(where.base);
    if (where.kind === "web" && where.local.startsWith("src/app/")) {
      const segments = rel.split("/").slice(0, -1);
      const last = segments.findLastIndex((segment) => /^\([^.].*\)$/.test(segment));
      if (last !== -1) groups.add(segments.slice(0, last + 1).join("/"));
    }
    if (rel.endsWith(".css") && !rel.endsWith(".module.css") && where.base)
      css.set(where.base, [...(css.get(where.base) ?? []), rel]);
    const own = CODE.test(rel);
    for (const message of fileProblems(rel, root, localized))
      add(own ? rel : anchorFor(rel.slice(0, rel.lastIndexOf("/")), lintable), own ? message : `${rel}: ${message}`);
    if (own && !isGenerated(rel) && DIRECTIVE.test(readFileSync(join(root, rel), "utf8"))) directives.push(rel);
  }
  for (const list of css.values()) {
    for (const rel of list.slice(1))
      add(
        anchorFor(rel.slice(0, rel.lastIndexOf("/")), lintable),
        `${rel}: Move these styles into ${list[0]}, the one global CSS file.`,
      );
  }
  for (const base of bases) {
    const kind = describe(`${base}/x`, root).kind;
    const routes = kind === "api" ? "src/app.ts" : `src/${routesDir(kind)}/`;
    for (const need of [routes, "src/lib/"]) {
      const present = need.endsWith("/")
        ? files.some((rel) => rel.startsWith(`${base}/${need}`))
        : files.includes(`${base}/${need}`);
      if (!present) add(anchorFor(base, lintable), `${base}: Add ${need}.`);
    }
  }
  for (const group of groups) {
    if (!files.includes(`${group}/error.tsx`))
      add(anchorFor(group, lintable), `${group}: Add an error.tsx with retry to the route group.`);
  }
  const tests = new Map();
  for (const rel of lintable.filter((file) => isTest(file) && !/^apps\/[^/]+\/e2e\//.test(file))) {
    const dir = rel.slice(0, rel.lastIndexOf("/") + 1);
    const key = dir + rel.slice(dir.length).split(".")[0];
    tests.set(key, [...(tests.get(key) ?? []), rel]);
  }
  for (const [key, list] of tests) {
    if (!lintable.some((rel) => !isTest(rel) && rel.startsWith(`${key}.`)))
      for (const rel of list)
        add(rel, `Name the test after the source file next to it; ${key.split("/").at(-1)}.ts does not exist.`);
    const suites = Map.groupBy(list, (rel) => DATABASE_SUITE.exec(rel)?.[1] ?? "");
    for (const suite of suites.values())
      for (const rel of suite.slice(1)) add(rel, `Merge this test into ${suite[0]}, the one test file for its source.`);
  }
  const clean = lintable.find((rel) => !directives.includes(rel));
  for (const rel of directives)
    add(clean, `${rel}: Delete the disable directive and fix the code, or change the standard.`);
  return findings;
}

function findingsFor(root) {
  const cached = scans.get(root);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.findings;
  const findings = scan(root);
  scans.set(root, { time: Date.now(), findings });
  return findings;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Files sit only where the standard puts them; repo-wide findings report on the nearest linted file.",
    },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where) return {};
    return {
      Program(node) {
        if (
          where.kind === "web" &&
          /^src\/app\/(?:.*\/)?route\.[cm]?[jt]sx?$/.test(where.local) &&
          !handlerAllowed(where, node, context.sourceCode.getText())
        )
          context.report({ node, message: HANDLER_MESSAGE });
        for (const message of findingsFor(where.root).get(where.rel) ?? []) context.report({ node, message });
      },
    };
  },
};
