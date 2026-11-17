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

test("docs passes a repository with no Markdown", (t) => {
  passes(t, { "src/a.ts": "export const a = 1;\n" });
});
