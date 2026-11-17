import assert from "node:assert/strict";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

function check(t, files, config = {}) {
  const cwd = tempRepo(t, config);
  write(cwd, files);
  git(cwd, "add", "-A");
  return standard(cwd, ["check", "docs"]);
}

function passes(t, files, config) {
  const { stdout, stderr, status } = check(t, files, config);
  assert.deepEqual([stdout, stderr, status], ["docs: OK\n", "", 0]);
}

function fails(t, files, ...lines) {
  const { stdout, stderr, status } = check(t, files);
  assert.equal(stderr, "");
  assert.equal(stdout, lines.map((line) => `docs: ${line}\n`).join(""));
  assert.equal(status, 1);
}

const UNKNOWN = "is no kind of doc the standard allows. Move conventions to docs/<name>.md or apps/<app>/docs/<name>.md and facts about an outside system to docs/external/<name>.md, or delete it.";
const REFUSED = "is named like a log or plan, and logs and plans are not docs. Delete it, and move any rule still in force into a conventions doc under docs/ or apps/<app>/docs/.";
const orphan = (path, from) => `${path} orphan: No link reaches ${path} from an AGENTS.md, a CLAUDE.md, .gemini/styleguide.md or a SKILL.md. Link it from ${from}.`;

test("docs passes every kind it names when each doc that needs a link has one", (t) => {
  passes(t, {
    "AGENTS.md": "# Guide\n\nRead [conventions](docs/conventions.md) and [vendor](docs/external/vendor.md).\n",
    "CLAUDE.md": "@AGENTS.md\n",
    "apps/api/AGENTS.md": "# Api\n\nSee [the ledger](docs/points-log.md) and [history](docs/history.md).\n",
    "apps/api/docs/points-log.md": "# Points\n",
    "apps/api/docs/history.md": "# History\n",
    "apps/api/docs/external/upstream.md": "# Upstream\n\n[Back](/AGENTS.md)\n",
    "apps/api/docs/index.md": "# Index\n\n[Upstream][up]\n\n[up]: external/upstream.md\n",
    "apps/api/CLAUDE.md": "@docs/index.md\n",
    "docs/conventions.md": "# Conventions\n",
    "docs/external/vendor.md": "# Vendor\n",
    ".gemini/styleguide.md": "# Review\n",
    ".claude/skills/pr/SKILL.md": "# Pr\n\n[Credits](CREDITS.md)\n",
    ".claude/skills/pr/CREDITS.md": "# Credits\n",
    ".claude/skills/verify-app/SKILL.md": "# Verify\n\n[Features](features/README.md)\n",
    ".claude/skills/verify-app/features/sign-in.md": "# Sign in\n",
    ".claude/skills/verify-app/features/README.md": "# Features\n\n[Sign in](sign-in.md)\n",
    "README.md": "# App\n",
    "apps/web/README.md": "# Web\n",
    "packages/ui/README.md": "# Ui\n",
    ".github/pull_request_template.md": "## Summary\n",
    ".github/PULL_REQUEST_TEMPLATE/release.md": "## Summary\n",
    "src/notes.ts": "export const notes = 1;\n",
  });
});

test("docs fails a Markdown file outside every kind, and a log or plan in any folder", (t) => {
  fails(
    t,
    {
      "AGENTS.md": "# Guide\n\n[Plan](docs/migration-plan.md)\n",
      "CHANGELOG.md": "# Changes\n",
      "DESIGN.md": "# Design\n",
      "apps/web/docs/navigation-progress.md": "# Progress\n",
      "docs/decision-log.md": "# Decisions\n",
      "docs/migration-plan.md": "# Plan\n",
      "docs/guide.mdx": "# Guide\n",
      "k8s/README.md": "# Cluster\n",
      ".claude/skills/pr/TODO.md": "# Todo\n",
    },
    `.claude/skills/pr/TODO.md kind: .claude/skills/pr/TODO.md ${REFUSED}`,
    `CHANGELOG.md kind: CHANGELOG.md ${REFUSED}`,
    `DESIGN.md kind: DESIGN.md ${UNKNOWN}`,
    `apps/web/docs/navigation-progress.md kind: apps/web/docs/navigation-progress.md ${REFUSED}`,
    `docs/decision-log.md kind: docs/decision-log.md ${REFUSED}`,
    `docs/guide.mdx kind: docs/guide.mdx ${UNKNOWN}`,
    `docs/migration-plan.md kind: docs/migration-plan.md ${REFUSED}`,
    `k8s/README.md kind: k8s/README.md ${UNKNOWN}`,
  );
});

test("docs fails the check-docs external marker, since the folder decides the kind", (t) => {
  fails(
    t,
    {
      "AGENTS.md": "# Guide\n\n[Vendor](docs/vendor-api.md), [legacy](apps/api/docs/legacy.md) and [old](docs/external/old.md).\n",
      "docs/vendor-api.md": "<!-- check-docs: external -->\n# Vendor\n",
      "apps/api/docs/legacy.md": "# Legacy\n\n<!-- check-docs: external -->\n",
      "docs/external/old.md": "<!-- check-docs: external -->\n# Old\n",
    },
    "apps/api/docs/legacy.md marker: apps/api/docs/legacy.md has <!-- check-docs: external -->, which the docs check ignores because the folder decides the kind. Move the doc to apps/api/docs/external/legacy.md and delete the marker.",
    "docs/external/old.md marker: docs/external/old.md has <!-- check-docs: external -->, which the docs check ignores because the folder decides the kind. Delete the marker.",
    "docs/vendor-api.md marker: docs/vendor-api.md has <!-- check-docs: external -->, which the docs check ignores because the folder decides the kind. Move the doc to docs/external/vendor-api.md and delete the marker.",
  );
});

test("docs fails a doc no link reaches from a root, and counts only links", (t) => {
  fails(
    t,
    {
      "AGENTS.md": "# Guide\n\nRead `docs/checks.md`.\n\n```md\n[setup](docs/setup.md)\n```\n\n[Readme](README.md)\n",
      "README.md": "# App\n\n[Usage](docs/usage.md)\n",
      "docs/checks.md": "# Checks\n",
      "docs/setup.md": "# Setup\n",
      "docs/usage.md": "# Usage\n",
      "docs/chain.md": "# Chain\n\n[Usage](usage.md)\n",
      "apps/api/AGENTS.md": "# Api\n",
      "apps/api/docs/backup.md": "# Backup\n",
      ".claude/skills/pr/SKILL.md": "# Pr\n",
      ".claude/skills/pr/CREDITS.md": "# Credits\n",
      ".claude/skills/verify-app/SKILL.md": "# Verify\n",
      ".claude/skills/verify-app/features/sign-in.md": "# Sign in\n",
    },
    orphan(".claude/skills/pr/CREDITS.md", ".claude/skills/pr/SKILL.md"),
    orphan(".claude/skills/verify-app/features/sign-in.md", ".claude/skills/verify-app/SKILL.md"),
    orphan("apps/api/docs/backup.md", "apps/api/AGENTS.md"),
    orphan("docs/chain.md", "AGENTS.md"),
    orphan("docs/checks.md", "AGENTS.md"),
    orphan("docs/setup.md", "AGENTS.md"),
    orphan("docs/usage.md", "AGENTS.md"),
  );
});

test("docs counts no link inside an HTML comment, even one over several lines", (t) => {
  fails(
    t,
    {
      "AGENTS.md": "# Guide\n\n<!--\n[Hidden](docs/hidden.md)\n```\n-->\nWrite `<!--` to start one, and read [usage](docs/usage.md).\n\nText <!-- [Old](docs/old.md) --> and <!-- a\n@docs/old.md\n-->\n",
      "docs/hidden.md": "# Hidden\n",
      "docs/old.md": "# Old\n",
      "docs/usage.md": "# Usage\n",
    },
    orphan("docs/hidden.md", "AGENTS.md"),
    orphan("docs/old.md", "AGENTS.md"),
  );
});

test("docs reads a link target with balanced parentheses whole", (t) => {
  passes(t, {
    "AGENTS.md": "# Guide\n\nRead [the guide](docs/guide(old).md) and [notes](<docs/notes (v2).md> \"Notes\").\n",
    "docs/guide(old).md": "# Guide\n",
    "docs/notes (v2).md": "# Notes\n",
  });
});

const GUIDE = { "docs/guide.md": "# Guide\n" };
const ORPHAN = [orphan("docs/guide.md", "AGENTS.md")];

for (const [name, agents, files, found] of [
  ["an unclosed comment opener inside a paragraph is text", "Use <!-- as the delimiter.\n\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["an escaped comment opener is text", "Use \\<!-- as text.\n\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["a comment opener in a code span over two lines is code", "Use `a\nb <!--` as a delimiter.\n\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["a comment opener in a code span is code", "Use `<!--` as a delimiter.\n\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["a comment opener in a double backtick span is code", "Use ``a ` <!--`` as a delimiter.\n\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["a comment opener in a fence is code", "```html\n<!--\n```\n\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["a fence inside a comment opens no code", "<!--\n```\n-->\n\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["a backtick inside a comment opens no code span", "<!-- ` -->\n[Guide](docs/guide.md)\n", GUIDE, []],
  ["an unclosed comment on its own line hides the rest of the doc", "<!--\n[hidden](docs/guide.md)\n", GUIDE, ORPHAN],
  ["a link in a fence nested in a longer fence is code", "````md\n```sh\necho example\n```\n[not rendered](docs/guide.md)\n````\n", GUIDE, ORPHAN],
  ["a definition no reference uses links nothing", "[guide]: docs/guide.md\n", GUIDE, ORPHAN],
  ["escaped parentheses in a link target are the parentheses", "[Guide](docs/guide\\(old\\).md)\n", { "docs/guide(old).md": "# Guide\n" }, []],
  ["nested balanced parentheses in a link target are part of it", "[Guide](docs/guide(old(v2)).md)\n", { "docs/guide(old(v2)).md": "# Guide\n" }, []],
]) {
  test(`docs reads links as CommonMark renders them: ${name}`, (t) => {
    const all = { "AGENTS.md": agents, ...files };
    if (found.length === 0) passes(t, all);
    else fails(t, all, ...found);
  });
}

test("docs passes a repository with no Markdown", (t) => {
  passes(t, { "src/a.ts": "export const a = 1;\n" });
});

const REFERENCED = {
  "AGENTS.md": "# Guide\n\n[Conventions](docs/conventions.md), [broken](docs/broken.md), [vendor](docs/external/vendor.md)\n",
  ".gitignore": ".env*\nlogs/\n",
  "package.json": JSON.stringify({ scripts: { build: "tsc" }, dependencies: { "@scope/pkg": "1.0.0" } }),
  "apps/api/package.json": JSON.stringify({ name: "api", scripts: { "test:parity": "node --test" } }),
  "packages/ui/package.json": JSON.stringify({ name: "@scope/ui", scripts: { storybook: "storybook dev" } }),
  "apps/api/src/x.ts": "export const parseThing = 1;\nexport const MAX_ITEMS = 2;\n",
  ".github/pull_request_template.md": "## Summary\n\nSee `missing.ts` and [nothing](nope.md).\n",
};

test("docs passes references that name tracked paths, globs, ignored paths, dependencies, scripts, symbols and headings", (t) => {
  passes(t, {
    ...REFERENCED,
    "AGENTS.md": "# Guide\n\n[Conventions](docs/conventions.md) and [the api guide](apps/api/docs/guide.md)\n",
    "apps/api/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]),
    "apps/api/docs/guide.md": "# Guide\n\nFrom `apps/api`, `../../docs/conventions.md` holds the rules.\n",
    "docs/conventions.md": [
      "# Conventions",
      "",
      "## Local db",
      "",
      "Read `src/x.ts`, `apps/api/src/x.ts`, `x.ts`, `apps/*/src/*.ts`, `src/*.ts`, `apps/api/src/x.ts:2` and `../apps/api/src/x.ts`.",
      "Name files by suffix, such as `.server.ts`, rule ids by prefix, such as `si/`, and screenshots, such as `figure-1-2.png`.",
      "Copy `apps/api/.env.local` and check `logs/`. Import `@scope/pkg/sub.js`.",
      "Skip `<name>.ts`, `$HOME/a.ts`, `~/a.md`, `/api/a.json` and `https://example.com/b.ts`.",
      "Call `parseThing()` with `MAX_ITEMS`.",
      "Run `pnpm --filter api test:parity`, `pnpm build`, `pnpm exec whatever`, `pnpm install`, `pnpm -C apps/api test:parity`, `pnpm --filter @scope/ui storybook` and `pnpm --filter ./packages/ui storybook`.",
      "See [local](#local-db), [apps](../apps/) and [api](/apps/api/src/x.ts).",
      "Use pnpm in prose without checking it.",
      "",
      "```sh",
      "pnpm build",
      "pnpm --filter=api run test:parity",
      "```",
      "",
    ].join("\n"),
  });
});

test("docs lists every reference in a doc that names nothing, and checks only links and local paths in external docs", (t) => {
  fails(
    t,
    {
      ...REFERENCED,
      "docs/conventions.md": "# Conventions\n\n## Local db\n",
      "docs/broken.md": [
        "# Broken",
        "",
        "Read `src/missing.ts`, `./nope.md` and `apps/*/src/*.go`.",
        "Call `parseWidget` and `MISSING_THING`.",
        "Run `pnpm check:docs` and `pnpm --filter api build`.",
        "See [setup `db`](conventions.md#setup) and [gone](gone.md), but not `[code](nowhere.md)`.",
        "",
        "```sh",
        "pnpm lint",
        "```",
        "",
      ].join("\n"),
      "docs/external/vendor.md": "# Vendor\n\nTheir `src/server/handler.go` calls `fetchVendorThing` through `pnpm vendor:sync`. Ours is `apps/api/src/gone.ts` and [x](missing.md).\n",
    },
    "docs/broken.md reference: docs/broken.md names things that do not exist: line 3 `src/missing.ts` (no tracked file ends with this path), line 3 `./nope.md` (no tracked file at docs/nope.md or from a folder above it), line 3 `apps/*/src/*.go` (no tracked file matches this glob), line 4 `parseWidget` (no tracked source has this word), line 4 `MISSING_THING` (no tracked source has this word), line 5 `pnpm check:docs` (no package.json has the script check:docs), line 5 `pnpm --filter api build` (api has no script build), line 6 [setup `db`](conventions.md#setup) (docs/conventions.md has no heading #setup), line 6 [gone](gone.md) (docs/gone.md is not tracked), line 9 `pnpm lint` (no package.json has the script lint). Fix each name, or move facts about an outside system to docs/external/.",
    "docs/external/vendor.md reference: docs/external/vendor.md names things that do not exist: line 3 `apps/api/src/gone.ts` (no tracked file ends with this path), line 3 [x](missing.md) (docs/external/missing.md is not tracked). Fix each name.",
  );
});

test("docs replaces the repository's check-docs script", (t) => {
  const { stdout } = standard(tempRepo(t), ["explain", "docs"]);
  assert.match(stdout, /^ {2}Replaces: scripts\/check-docs\.mjs, scripts\/check-docs\.test\.mjs$/m);
});
