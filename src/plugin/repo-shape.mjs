import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { UI_APPS, describe, isGenerated, isTest, locate, stem } from "./paths.mjs";

const APPS = new Set(["api", "web", "liff", "marketing", "mobile"]);
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
const SKIP = new Set([
  ".git",
  "node_modules",
  ".next",
  ".expo",
  ".astro",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
]);
const scans = new Map();

function routesDir(kind) {
  return kind === "marketing" ? "pages" : "app";
}

function webRoute(rest, name) {
  const segments = rest.split("/").slice(1, -1);
  const found = [];
  for (const segment of segments) {
    if (segment.startsWith("@")) found.push("No parallel routes. Compose the sections inside one page.");
    if (/^\(\.{1,3}\)/.test(segment)) found.push("No intercepting routes. Link to the real route.");
    if (segment.startsWith("_"))
      found.push("No _private folders in app/. Move the code into a feature or components/.");
  }
  const file = stem(name);
  if (file === "loading")
    found.push("No loading.tsx. Wrap the slow section in <Section fallback> from components/boundary/section.tsx.");
  else if (file === "default") found.push("No parallel routes, so no default.tsx.");
  else if (!NEXT_FILES.has(file))
    found.push("app/ holds only Next route files. Move this code into a feature or components/.");
  if (file === "route" && !segments.includes("webhooks") && !segments.at(-1)?.includes(".")) {
    found.push(
      "route.ts serves only webhooks (under a webhooks/ folder) and metadata files like sitemap.xml/route.ts.",
    );
  }
  return found;
}

function codeProblems(where) {
  const { kind, pkg, local, name, feature } = where;
  if (isGenerated(name)) return [];
  if (!local.includes("/"))
    return /\.config\./.test(name)
      ? []
      : [`${kind ? "App" : "Package"} root holds config only. Move this code into src/.`];
  if (!local.startsWith("src/")) return ["Code lives in src/."];
  if (pkg) return [];
  const rest = local.slice(4);
  const parts = rest.split("/");
  const found = [];
  if (isTest(name) && !["features", "lib", "components"].includes(parts[0])) {
    found.push(
      parts[0] === routesDir(kind)
        ? "Route files never have tests. Test the feature code instead."
        : "Tests sit next to the code they test in features/, lib/ or components/.",
    );
  }
  if (parts[0] === "features") {
    if (parts.length !== 3)
      return [...found, "Feature folders hold files only, no subfolders. Split a big feature into two features."];
    const base = stem(name).replace(/\.test$/, "");
    if (kind === "api") {
      if (!API_FEATURE_FILES.has(base)) found.push("API feature files are routes.ts, schema.ts, db.ts and service.ts.");
    } else if (base !== feature && !base.startsWith(`${feature}-`)) {
      found.push(`Prefix the file with its feature: ${feature}-${base}.`);
    }
    return found;
  }
  if (parts[0] === "lib") return found;
  if (kind === "api") {
    if (parts.length === 1 && ["app.ts", "factory.ts", "env.ts"].includes(name)) return found;
    if (parts.length === 2 && ["middleware", "infra", "upstreams"].includes(parts[0])) return found;
    return [
      ...found,
      "API code lives in app.ts, factory.ts, env.ts, middleware/, lib/, infra/, upstreams/ or features/<resource>/.",
    ];
  }
  if (parts[0] === "components") {
    return parts.length === 3 ? found : [...found, "Components live in components/<group>/<file>, one level deep."];
  }
  if (parts[0] === routesDir(kind)) return kind === "web" ? [...found, ...webRoute(rest, name)] : found;
  if (parts.length === 1) {
    if (kind === "web" && WEB_ROOT_FILES.has(stem(name))) return found;
    if (kind === "liff" && name === "main.tsx") return found;
    if (kind === "marketing" && stem(name) === "content.config") return found;
  }
  if (kind === "marketing" && parts[0] === "content") return found;
  return [...found, `Code lives in src/${routesDir(kind)}/, src/features/, src/components/ or src/lib/.`];
}

function fileProblems(rel) {
  const where = describe(rel);
  const parts = rel.split("/");
  const { name, kind, pkg, base, local } = where;
  const found = [];
  if (parts.length > 1 && !TOP_DIRS.has(parts[0]))
    return ["The top level holds only apps/, packages/ and config files."];
  if (parts[0] === "apps" && parts.length > 2 && !APPS.has(kind)) return [`Apps are ${[...APPS].join(", ")}.`];
  if (parts[0] === "packages" && parts.length > 2 && !PACKAGES.has(pkg))
    return [`Packages are ${[...PACKAGES].join(", ")}.`];
  if (/\.mdx?$/.test(name)) {
    const exempt = rel.startsWith(".claude/skills/") || (kind === "marketing" && local.startsWith("src/content/"));
    const placed = DOCS.has(name) && (parts.length === 1 || (base && local === name));
    if (!exempt && !placed)
      found.push(
        "Markdown is only README.md and AGENTS.md, one each per repo and per app. Put the rest in one of them or delete it.",
      );
  }
  if (/\.(?:scss|sass|less|styl)$/.test(name)) found.push("Tailwind only. Use the one global CSS file.");
  if (name.endsWith(".module.css")) found.push("No CSS modules. Use Tailwind classes.");
  if (name.endsWith(".css") && !base) found.push("CSS lives in an app or package, one global file each.");
  if (
    name.endsWith(".astro") &&
    !(kind === "marketing" && (local.startsWith("src/pages/") || local.startsWith("src/components/layout/")))
  ) {
    found.push("Astro files live only in src/pages/ and src/components/layout/. Write components as .tsx.");
  }
  if (parts.length === 1 && CODE.test(name) && !/\.config\./.test(name))
    found.push("The top level holds only config. Move this code into an app or package.");
  if (base && CODE.test(name)) found.push(...codeProblems(where));
  return found;
}

function ignoredNames(root) {
  const path = join(root, ".gitignore");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  return new Set([
    ...SKIP,
    ...lines.map((line) => line.trim().replace(/^\/|\/$/g, "")).filter((line) => line && !/[*!#/]/.test(line)),
  ]);
}

function listFiles(root) {
  const skip = ignoredNames(root);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk("");
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
    const where = describe(rel);
    if (where.base && APPS.has(where.kind)) bases.add(where.base);
    if (where.kind === "web" && where.local.startsWith("src/app/")) {
      const segments = rel.split("/").slice(0, -1);
      const last = segments.findLastIndex((segment) => /^\([^.].*\)$/.test(segment));
      if (last !== -1) groups.add(segments.slice(0, last + 1).join("/"));
    }
    if (rel.endsWith(".css") && !rel.endsWith(".module.css") && where.base)
      css.set(where.base, [...(css.get(where.base) ?? []), rel]);
    const own = CODE.test(rel);
    for (const message of fileProblems(rel))
      add(own ? rel : anchorFor(rel.slice(0, rel.lastIndexOf("/")), lintable), own ? message : `${rel}: ${message}`);
    if (own && !isGenerated(rel) && DIRECTIVE.test(readFileSync(join(root, rel), "utf8"))) directives.push(rel);
  }
  for (const list of css.values()) {
    for (const rel of list.slice(1))
      add(
        anchorFor(rel.slice(0, rel.lastIndexOf("/")), lintable),
        `${rel}: One global CSS file per app or package; ${list[0]} is the global.`,
      );
  }
  for (const base of bases) {
    const kind = base.split("/")[1];
    const routes = kind === "api" ? "src/app.ts" : `src/${routesDir(kind)}/`;
    for (const need of [routes, "src/lib/"]) {
      const present = need.endsWith("/")
        ? files.some((rel) => rel.startsWith(`${base}/${need}`))
        : files.includes(`${base}/${need}`);
      if (!present)
        add(anchorFor(base, lintable), `${base}: Every ${UI_APPS.has(kind) ? "UI app" : "API"} has ${need}.`);
    }
  }
  for (const group of groups) {
    if (!files.includes(`${group}/error.tsx`))
      add(anchorFor(group, lintable), `${group}: Each route group has an error.tsx with retry.`);
  }
  const tests = new Map();
  for (const rel of lintable.filter((file) => isTest(file))) {
    const dir = rel.slice(0, rel.lastIndexOf("/") + 1);
    const key = dir + rel.slice(dir.length).split(".")[0];
    tests.set(key, [...(tests.get(key) ?? []), rel]);
  }
  for (const [key, list] of tests) {
    if (!lintable.some((rel) => !isTest(rel) && rel.startsWith(`${key}.`)))
      for (const rel of list)
        add(
          rel,
          `Tests sit next to the code they test. Name the file after its source: ${key.split("/").at(-1)}.ts needs to exist.`,
        );
    for (const rel of list.slice(1)) add(rel, `One test file per source file. Merge into ${list[0]}.`);
  }
  const clean = lintable.find((rel) => !directives.includes(rel));
  for (const rel of directives)
    add(clean, `${rel}: Remove the oxlint/eslint disable directive. Fix the code or change the standard.`);
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
