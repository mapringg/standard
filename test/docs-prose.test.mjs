import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const NO_BASELINE = "Fix each as its line says. The check has no baseline, so it allows none; never create one to make it pass.";
const DASH = 'Use a comma, a colon, parentheses or two sentences, and write ranges as "1 to 3".';
const HEADING = "Capitalize only the first word and proper names.";
const FILLER = "Delete it, or name the specific thing it stands in for.";
const LENGTH = "Split each one.";

const words = (count) => Array.from({ length: count }, (_, at) => `word${at}`).join(" ");

function prose(t, files, ...flags) {
  const cwd = tempRepo(t, {});
  write(cwd, files);
  git(cwd, "add", "-A");
  return { cwd, ...standard(cwd, ["check", "docs-prose", ...flags]) };
}

function passes(t, files) {
  const { stdout, stderr, status } = prose(t, files);
  assert.deepEqual([stdout, stderr, status], ["docs-prose: OK\n", "", 0]);
}

function fails(t, files, ...fixes) {
  const { stdout, stderr, status } = prose(t, files);
  assert.equal(stderr, "");
  assert.equal(stdout, [`docs-prose: ${fixes.length} new findings.`, ...fixes.map((fix) => `  ${fix}`), NO_BASELINE, ""].join("\n"));
  assert.equal(status, 1);
}

test("docs-prose fails en and em dashes outside code, in prose, headings and tables", (t) => {
  passes(t, {
    "docs/a.md": "# Setup\n\nRun `a – b`.\n\n```sh\necho —\n```\n",
    "apps/web/AGENTS.md": "<!-- BEGIN:nextjs-agent-rules -->\n# Next Rules\n\nThis version has breaking changes — read the guide.\n<!-- END:nextjs-agent-rules -->\n",
  });
  fails(
    t,
    { "docs/a.md": "# Setup – local\n\nPages 1–3 load — slowly.\n\n| A | B — C |\n| --- | --- |\n" },
    `docs/a.md has en or em dashes on lines 1, 3, 5. ${DASH}`,
  );
});

test("docs-prose fails a heading in title case, and passes proper names, required headings and new sentences", (t) => {
  passes(t, {
    ".github/pull_request_template.md": "## Summary\n\n## Merge Danger\n",
    "docs/a.md": [
      "# Figma tokens",
      "",
      "Export the tokens from Figma before the build.",
      "",
      "## 1. Launch the GitHub app and the API",
      "",
      "## Phase 1. The harness",
      "",
      "## Home page: Favorite panel",
      "",
      "## Using `Next.js` with Next.js routes",
      "",
    ].join("\n"),
  });
  fails(
    t,
    { "docs/a.md": "# Local Dev Setup\n\nFigma starts a sentence here.\n\n## Figma Tokens\n" },
    `docs/a.md has headings not in sentence case on line 1 "Local Dev Setup", line 5 "Figma Tokens". ${HEADING}`,
  );
});

test("docs-prose fails a filler word or phrase in any case, and passes it in code or inside a hyphenated word", (t) => {
  passes(t, { "docs/a.md": "# Cache\n\nCompile just-in-time and read `just` from the [notes](https://example.com/simply).\n" });
  fails(
    t,
    { "docs/a.md": "# Cache\n\nJust run it.\n\nIn order to ship, note that it is very robust.\n" },
    `docs/a.md uses filler on line 3 "Just", line 5 "In order to", line 5 "note that", line 5 "very", line 5 "robust". ${FILLER}`,
  );
});

test("docs-prose fails a sentence over 40 words, counting a code span or a link as one word", (t) => {
  passes(t, {
    "docs/a.md": [
      "# Length",
      "",
      `${words(38)} \`one span of code\` [a long link](https://example.com).`,
      `Then e.g. this ${words(36)} ends.`,
      "",
      `| ${words(50)} |`,
      "",
      `> ${words(50)}`,
      "",
      "```",
      words(50),
      "```",
      "",
    ].join("\n"),
  });
  fails(
    t,
    { "docs/a.md": `# Length\n\nShort one. Use e.g. Next ${words(38)}.\n\n- ${words(40)}\n  ${words(5)}.\n` },
    `docs/a.md has sentences over 40 words on line 3 (41 words), line 5 (45 words). ${LENGTH}`,
  );
});

test("docs-prose leaves logs and files of no kind to docs", (t) => {
  passes(t, { "docs/decision-log.md": "# Big Log\n\nIt is just — very long.\n", "DESIGN.md": "# Big Design\n" });
});

test("docs-prose keeps a baseline that counts each occurrence, so a sixth long sentence fails against five", (t) => {
  const long = `Start ${words(44)}.`;
  const { cwd, stdout, status } = prose(t, { "docs/a.md": `# Length\n\n${Array(5).fill(long).join(" ")}\n` }, "--init");
  assert.deepEqual([stdout, status], ["docs-prose: wrote 5 findings to .standard/baselines/docs-prose.json\n", 0]);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".standard/baselines/docs-prose.json"), "utf8")), { "docs-prose": Array(5).fill("docs/a.md length") });
  assert.deepEqual(standard(cwd, ["check", "docs-prose"]).status, 0);
  write(cwd, { "docs/a.md": `# Length\n\nFirst line.\n${Array(6).fill(long).join(" ")}\n` });
  const grown = standard(cwd, ["check", "docs-prose"]);
  assert.match(grown.stdout, /^docs-prose: 1 new findings\.\n {2}docs\/a\.md has sentences over 40 words on line 4 \(45 words\), line 4 \(45 words\)/);
  assert.equal(grown.status, 1);
});
