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
