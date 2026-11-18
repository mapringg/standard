import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, matchesGlob } from "node:path";

import { UI_APPS, describe, isGenerated, isTest, isTestSupport, locate, stem } from "./paths.mjs";

const PACKAGES = new Set(["tokens", "i18n"]);
const TOP_DIRS = new Set(["apps", "packages", ".github", ".githooks", ".claude", ".vscode"]);
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
const WEB_ROOT_FILES = new Set(["proxy", "instrumentation", "instrumentation-client"]);
const CACHE_MS = 2000;
const SKIP = new Set([".git", "node_modules"]);
const scans = new Map();

function routesDir(kind) {
  return kind === "marketing" ? "pages" : "app";
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
      "Delete loading.tsx and wrap the slow section in <Section fallback> from @/components/boundary/section.",
    );
  else if (file === "default") found.push("Delete default.tsx and compose the sections inside one page.");
  else if (!NEXT_FILES.has(file))
    found.push("Move this code into a feature or components/; app/ holds only Next route files.");
  if (file === "route" && !segments.includes("webhooks") && !segments.at(-1)?.includes(".")) {
    found.push(
      "Move the handler into a webhooks/ folder or a metadata route like sitemap.xml/route.ts, or into a Server Action.",
    );
  }
  return found;
}

function codeProblems(where) {
  const { kind, pkg, local, name, feature } = where;
  if (isGenerated(name)) return [];
  if (local.startsWith("e2e/")) {
    return local.split("/").length === 2 && isTestSupport(name)
      ? []
      : ["Move the journey to apps/<app>/e2e/<journey>.test.ts."];
  }
  if (!local.includes("/"))
    return /\.config\./.test(name)
      ? []
      : [`${kind ? "App" : "Package"} root holds config only. Move this code into src/.`];
  if (!local.startsWith("src/")) return ["Move the code into src/."];
  if (pkg) return [];
  const rest = local.slice(4);
  const parts = rest.split("/");
  const found = [];
  if (isTestSupport(name) && !["features", "lib", "components"].includes(parts[0])) {
    found.push(
      parts[0] === routesDir(kind)
        ? "Move the test to the feature code it covers; route files never have tests."
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
    if (parts.length === 1 && ["app.ts", "factory.ts", "env.ts", "server.ts", "client.ts"].includes(name)) return found;
    if (parts.length === 2 && ["middleware", "infra", "upstreams"].includes(parts[0])) return found;
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
    return ["Make the app a Hono service (src/factory.ts), or a Next, Vite, Expo or Astro app in its package.json."];
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
  if (
    name.endsWith(".astro") &&
    !(kind === "marketing" && (local.startsWith("src/pages/") || local.startsWith("src/components/layout/")))
  ) {
    found.push("Write this component as .tsx; .astro files live only in src/pages/ and src/components/layout/.");
  }
  if (/\.spec\.[cm]?[jt]sx?$/.test(name)) found.push("Rename the test to *.test.ts or *.test.tsx.");
  if (
    CODE.test(name) &&
    /^(?:.*[-.])?(?:helpers?|mocks?|stubs?|fakes?|test-?utils|setup)\.[cm]?[jt]sx?$/.test(name) &&
    !/\.test-utils\.[cm]?[jt]sx?$/.test(name)
  ) {
    found.push("Rename the file to <name>.fixture.ts or <name>.test-utils.ts.");
  }
  if (
    kind &&
    UI_APPS.has(kind) &&
    /(?:^|\/)(?:i18n|messages)\//.test(local) &&
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

function ignoreRules(root, dir, file) {
  const path = join(root, dir, file);
  if (!existsSync(path)) return [];
  const rules = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    let pattern = negate ? line.slice(1) : line;
    const dirOnly = pattern.endsWith("/");
    pattern = pattern.replace(/\/$/, "");
    const anchored = pattern.includes("/");
    rules.push({ dir, pattern: pattern.replace(/^\//, ""), negate, dirOnly, anchored });
  }
  return rules;
}

function ignored(rules, rel, isDir) {
  let result = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.dir && !rel.startsWith(`${rule.dir}/`)) continue;
    const local = rule.dir ? rel.slice(rule.dir.length + 1) : rel;
    const target = rule.anchored ? local : local.slice(local.lastIndexOf("/") + 1);
    if (matchesGlob(target, rule.pattern)) result = !rule.negate;
  }
  return result;
}

function listFiles(root) {
  const files = [];
  const walk = (dir, inherited) => {
    const rules = [...inherited, ...ignoreRules(root, dir, ".gitignore")];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (ignored(rules, rel, entry.isDirectory())) continue;
      if (entry.isDirectory()) walk(rel, rules);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk("", ignoreRules(root, ".git/info", "exclude"));
  return files.sort();
}

function anchorFor(path, lintable) {
  for (let dir = path; ; dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "") {
    const prefix = dir ? `${dir}/` : "";
    const hit = lintable.find((file) => file.startsWith(prefix));
    if (hit) return hit;
    if (!dir) return null;
  }
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
    for (const rel of list.slice(1)) add(rel, `Merge this test into ${list[0]}, the one test file for its source.`);
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
        for (const message of findingsFor(where.root).get(where.rel) ?? []) context.report({ node, message });
      },
    };
  },
};
