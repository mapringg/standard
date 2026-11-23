import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { lint, only } from "./lint.mjs";

const code = "export const a = 1;\n";
const base = {
  "apps/web/src/app/page.tsx": code,
  "apps/web/src/lib/log.ts": code,
};

function findings(t, files) {
  return only(lint(t, { ...base, ...files }), "agent-docs")
    .map((item) => item.message)
    .sort();
}

const GOOD = `# Repo

Follow the standard.

## Rules

- Commits are one subject line. See [web](apps/web/AGENTS.md#decisions).
- Callbacks end in \`/api/auth/callback\`; the dev shell is \`/dev/shm\`.

## Decisions

- Group members share cache keys (owner, 2026-10-02).

## Operations

- Sidecar Chrome listens on \`127.0.0.1:9222\`.
`;

const WEB = `# Web

## Decisions

- A Server Component can't set a cookie.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

Read \`node_modules/next/dist/docs/\` for 16.4.5.

<!-- END:nextjs-agent-rules -->
`;

test("agent-docs accepts the shared shape and generated blocks", (t) => {
  deepEqual(findings(t, { "AGENTS.md": GOOD, "apps/web/AGENTS.md": WEB }), []);
});

test("agent-docs wants one title and known sections in order", (t) => {
  deepEqual(
    findings(t, {
      "AGENTS.md": "Intro\n\n# A\n\n## Decisions\n\n## Rules\n\n## Layout\n\n### Deep\n\n# B\n",
    }),
    [
      "AGENTS.md: Keep one # title; make the others ## sections.",
      "AGENTS.md: Put each section once, in the order Rules, Words, Copy, Decisions, Traps, Operations, Sources.",
      "AGENTS.md: Rename the section Layout to one of Rules, Words, Copy, Decisions, Traps, Operations, Sources.",
      "AGENTS.md: Start with one # title naming the app or repo.",
      "AGENTS.md: Use only ## sections; fold deeper headings into bullets.",
    ],
  );
});

test("agent-docs caps the length", (t) => {
  deepEqual(findings(t, { "AGENTS.md": `# A\n\n## Rules\n\n${"- x\n".repeat(60)}` }), [
    "AGENTS.md: Cut it to 50 lines; keep only what the code and lint cannot tell an agent.",
  ]);
});

test("agent-docs rejects file paths and versions", (t) => {
  deepEqual(
    findings(t, {
      "AGENTS.md":
        "# A\n\n## Rules\n\n- Use `src/lib/env.ts` and `lib/query.ts`, see [x](apps/web/src/app/page.tsx).\n- Pin v1.2.3.\n",
    }),
    [
      "AGENTS.md: Drop v1.2.3; the lockfile and manifests already pin versions.",
      "AGENTS.md: Name what src/lib/env.ts, lib/query.ts, apps/web/src/app/page.tsx is instead of where it lives; paths go stale when files move.",
    ],
  );
});

test("agent-docs checks relative Markdown links in every Markdown file", (t) => {
  deepEqual(
    findings(t, {
      "AGENTS.md": GOOD,
      "apps/web/AGENTS.md": WEB,
      "docs/guide.md":
        "[a](../AGENTS.md#rules) [b](../AGENTS.md#gone) [c](missing.md) [d](https://x.dev/y) [e](#top)\n",
    }),
    [
      "docs/guide.md: Fix the link to #top; docs/guide.md has no heading #top.",
      "docs/guide.md: Fix the link to ../AGENTS.md#gone; AGENTS.md has no heading #gone.",
      "docs/guide.md: Fix the link to missing.md; docs/missing.md does not exist.",
    ],
  );
});

test("agent-docs leaves fenced and generated blocks out of the length, paths and versions", (t) => {
  const fenced = `# A\n\n## Rules\n\n~~~~\n${"v1.2.3 [x](missing.md)\n".repeat(60)}~~~\n~~~~\n\n\`\`\`\n${"- x\n".repeat(60)}\`\`\`\n\n<!-- BEGIN:tool -->\n${"- y\n".repeat(60)}<!-- END:tool -->\n\n- Last line.\n`;
  deepEqual(findings(t, { "AGENTS.md": fenced }), []);
});

test("agent-docs reads link destinations the way Markdown does", (t) => {
  deepEqual(
    findings(t, {
      "AGENTS.md": GOOD,
      "apps/web/AGENTS.md": WEB,
      "some file.md": "# Hello ###\n\n## Hello\n\n# Use [foo](https://example.com)\n",
      "docs/ok.md": [
        "[a](../some%20file.md#hello) [b](<../some file.md#hello-1>) [c](../some%20file.md?plain=1#use-foo)",
        "[d](../apps/web/AGENTS.md#this-is-not-the-nextjs-you-know) `[e](missing.md)` [f][ref]",
        "",
        "[ref]: ../AGENTS.md#rules",
      ].join("\n"),
      "docs/bad.md": '[a](missing.md "Title")\n\n[b][gone]\n\n[gone]: ../nowhere.md\n',
    }),
    [
      "docs/bad.md: Fix the link to ../nowhere.md; nowhere.md does not exist.",
      "docs/bad.md: Fix the link to missing.md; docs/missing.md does not exist.",
    ],
  );
});

test("agent-docs tells repository paths from endpoints and repository names", (t) => {
  deepEqual(
    findings(t, {
      "AGENTS.md":
        "# A\n\n## Rules\n\n- Serve `/api/schema.json` and `/dev/shm`; read `owner/repo` on GitHub.\n- Avoid `.github/workflows/` and `node_modules/next/dist/docs/` and `pnpm exec vitest run #/lib/env.ts`.\n",
    }),
    [
      "AGENTS.md: Name what .github/workflows/, node_modules/next/dist/docs/, #/lib/env.ts is instead of where it lives; paths go stale when files move.",
    ],
  );
});

test("agent-docs handles inline fences, multiline code spans and colliding anchors", (t) => {
  deepEqual(
    findings(t, {
      "AGENTS.md": GOOD,
      "apps/web/AGENTS.md": WEB,
      "notes.md": [
        "# Foo",
        "# Foo",
        "# Foo-1",
        "# Foo",
        "# Use [foo][ref]",
        "# Use [foo [bar]](https://example.com)",
        "",
        "[ref]: https://example.com",
        "",
        "[a](#foo-1-1) [b](#foo-2) [c](#use-foo) [d](#use-foo-bar)",
        "",
        "Some `",
        "[x](missing.md)",
        "` code.",
        "",
        "```inline code```",
        "[y](gone.md)",
      ].join("\n"),
    }),
    ["notes.md: Fix the link to gone.md; gone.md does not exist."],
  );
});

const skillRoot = "node_modules/@mapringg/standard/.claude/skills";
const prSkill = `${skillRoot}/pr/SKILL.md`;
const auditSkill = `${skillRoot}/test-audit/SKILL.md`;
const reviewSkill = `${skillRoot}/review-standard/SKILL.md`;
const standardInstall = {
  "node_modules/@mapringg/standard/package.json": '{"name":"@mapringg/standard"}',
  [prSkill]: "# Pull request writing\n",
  [auditSkill]: "# Test audit\n",
  [reviewSkill]: "# Standard review\n",
};
const skillLinks = `# Adopter

## Sources

- [PR writing](${prSkill})
- [Test audit](${auditSkill})
- [Standard review](${reviewSkill})
`;

test("adopters with no root agent instructions are told where to add the standard skills", (t) => {
  deepEqual(findings(t, standardInstall), [
    `AGENTS.md: Add [PR writing](${prSkill}) under ## Sources for starting a change and writing pull requests.`,
    `AGENTS.md: Add [Standard review](${reviewSkill}) under ## Sources for branch and pull request reviews.`,
    `AGENTS.md: Add [Test audit](${auditSkill}) under ## Sources for migrations and broad refactors.`,
  ]);
});

test("adopters put the skill references in agent instructions even when README links to them", (t) => {
  deepEqual(findings(t, { ...standardInstall, "AGENTS.md": "# Adopter\n", "README.md": skillLinks }), [
    `AGENTS.md: Add [PR writing](${prSkill}) under ## Sources for starting a change and writing pull requests.`,
    `AGENTS.md: Add [Standard review](${reviewSkill}) under ## Sources for branch and pull request reviews.`,
    `AGENTS.md: Add [Test audit](${auditSkill}) under ## Sources for migrations and broad refactors.`,
  ]);
});

test("adopters link the installed skills without local copies", (t) => {
  deepEqual(findings(t, { ...standardInstall, "AGENTS.md": skillLinks }), []);
  deepEqual(
    findings(t, {
      ...standardInstall,
      "AGENTS.md": skillLinks,
      ".claude/skills/pr/SKILL.md": "# Old PR writing\n",
      ".claude/skills/review-standard/SKILL.md": "# Old review\n",
      ".claude/skills/test-audit/SKILL.md": "# Old audit\n",
    }),
    [
      ".claude/skills/pr/SKILL.md: Remove the local copy and use the installed standard skill linked in AGENTS.md.",
      ".claude/skills/review-standard/SKILL.md: Remove the local copy and use the installed standard skill linked in AGENTS.md.",
      ".claude/skills/test-audit/SKILL.md: Remove the local copy and use the installed standard skill linked in AGENTS.md.",
    ],
  );
});

test("monorepo READMEs accept 60 root and 40 app prose lines with flexible headings", (t) => {
  const example = "```sh\n" + "pnpm test\n".repeat(70) + "```\n";
  deepEqual(
    findings(t, {
      "README.md": `# Repo\n\n## Getting started\n\n${"Run the app.\n\n".repeat(58)}${example}`,
      "apps/web/README.md": `# Web\n\n### Run locally\n\n${"Open the app.\n".repeat(38)}${example}`,
    }),
    [],
  );
});

test("monorepo READMEs report prose over budget and missing or duplicate titles", (t) => {
  deepEqual(
    findings(t, {
      "README.md": `## Read this\n${"Run the app.\n".repeat(60)}`,
      "apps/web/README.md": `# Web\n# Another title\n${"Open the app.\n".repeat(39)}`,
    }),
    [
      "README.md: Cut it to 60 prose lines; keep setup, checks, and operational decisions.",
      "README.md: Use one # title naming the project.",
      "apps/web/README.md: Cut it to 40 prose lines; keep setup, checks, and operational decisions.",
      "apps/web/README.md: Use one # title naming the project.",
    ],
  );
});

test("standalone package and skill READMEs have no monorepo prose budget", (t) => {
  const long = "Extended reference.\n".repeat(80);
  deepEqual(only(lint(t, { "src/index.ts": code, "README.md": long }), "agent-docs"), []);
  deepEqual(findings(t, { ".claude/skills/verify/README.md": long, "packages/tokens/README.md": long }), []);
});
