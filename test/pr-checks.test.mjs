import assert from "node:assert/strict";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GOOD_BODY, checkEvent, git, pullRequestEvent, pullRequestRepo, standard, tempDir, tempRepo, WIRED, write } from "./helpers.mjs";

const PAIR = "**Before:** 3 fail.\n\n**After:** 0 fail.";

function checkPullRequest(t, repo, pr = {}, names = []) {
  return checkEvent(t, repo.cwd, pullRequestEvent({ base: repo.base, head: repo.head, ...pr }), names);
}

function body({ summary = "Accept a Before/After table as evidence.", evidence, ticket }) {
  return [
    ...(ticket ? [ticket, ""] : []),
    "## Summary",
    "",
    summary,
    "",
    "## Evidence",
    "",
    "Ran the check against a sample body.",
    "",
    evidence,
    "",
    "## Merge Danger",
    "",
    "**Door:** two-way",
    "",
    "**Blast Radius:** annotations",
  ].join("\n");
}

function checkBody(t, prBody, { config } = {}) {
  const repo = pullRequestRepo(t, { base: config ? { ".standard/config.json": config } : {} });
  return checkPullRequest(t, repo, { body: prBody }, ["pr-body"]);
}

const BODY_OK = "pr-body: OK (#123)";
const EVIDENCE_NOTE = /::warning title=pr-body::Evidence: Evidence has no "\*\*Before:\*\*"/;

test("pr-body accepts a bold Before/After pair", (t) => {
  const { stdout, status } = checkBody(t, body({ evidence: PAIR }));
  assert.equal(stdout.trim(), BODY_OK);
  assert.equal(status, 0);
});

test("pr-body accepts a table with Before and After columns", (t) => {
  const evidence = [
    "| | Before | After |",
    "| --- | --- | --- |",
    "| Summary card | ![before](https://example.com/a.png) | ![after](https://example.com/b.png) |",
  ].join("\n");
  assert.equal(checkBody(t, body({ evidence })).stdout.trim(), BODY_OK);
});

test("pr-body warns on a table with only an After column", (t) => {
  const evidence = ["| | After |", "| --- | --- |", "| Summary card | ![after](https://example.com/b.png) |"].join("\n");
  const { stdout, status } = checkBody(t, body({ evidence }));
  assert.match(stdout, EVIDENCE_NOTE);
  assert.equal(status, 0);
});

test("pr-body warns when Evidence has no before and after", (t) => {
  assert.match(checkBody(t, body({ evidence: "Nothing captured." })).stdout, EVIDENCE_NOTE);
});

test("pr-body warns when the Before/After pair sits outside the Evidence section", (t) => {
  const prBody = body({ summary: "**Before:** one form.\n\n**After:** two forms.", evidence: "Nothing captured." });
  assert.match(checkBody(t, prBody).stdout, EVIDENCE_NOTE);
});

test("pr-body reads past a fenced comment line inside Evidence", (t) => {
  const evidence = "```sh\n# run the check\n```\n\n**Before:** 3 fail.\n\n**After:** 0 fail.";
  assert.equal(checkBody(t, body({ evidence })).stdout.trim(), BODY_OK);
});

test("pr-body ignores HTML comments, so an untouched template is empty", (t) => {
  const { stdout, status } = checkBody(t, "<!--\nTicket: ABC-000\n-->\n");
  assert.equal(stdout.trim(), "::warning title=pr-body::description: Description is empty. Fill in the pull request template.");
  assert.equal(status, 0);
});

test("pr-body warns on a missing Merge Danger section, a short body and a template placeholder", (t) => {
  const prBody = "## Summary\n\nShort.\n\n## Evidence\n\n- **Before:** <screenshot/output/failing test run>\n  **After:** done";
  const { stdout, status } = checkBody(t, prBody);
  for (const note of [
    /description: Description is \d+ characters of real content; write at least 120\./,
    /Merge Danger: Description has no "## Merge Danger" section\./,
    /Door: Merge Danger has no "\*\*Door:\*\* one-way" or "\*\*Door:\*\* two-way"\./,
    /Blast Radius: Merge Danger has no "\*\*Blast Radius:\*\*"\./,
    /placeholder: Description still carries a template placeholder\./,
  ]) {
    assert.match(stdout, new RegExp(`::warning title=pr-body::${note.source}`));
  }
  assert.doesNotMatch(stdout, /::error/);
  assert.equal(status, 0);
});

test("pr-body warns when Blast Radius is more than one word, before its first period", (t) => {
  const twoWords = body({ evidence: PAIR }).replace("annotations", "message list");
  assert.match(checkBody(t, twoWords).stdout, /Blast Radius: Blast Radius "message list" is more than one word/);
  const described = body({ evidence: PAIR }).replace("annotations", "navigation. Back returns to the list.");
  assert.equal(checkBody(t, described).stdout.trim(), BODY_OK);
});

test("pr-body accepts a ticket line first when the config sets the prefix", (t) => {
  const config = { pr: { "ticket-prefix": "ABC" } };
  assert.equal(checkBody(t, body({ evidence: PAIR, ticket: "Ticket: ABC-12" }), { config }).stdout.trim(), BODY_OK);
  assert.equal(checkBody(t, body({ evidence: PAIR }), { config }).stdout.trim(), BODY_OK);
});

test("pr-body warns on a malformed or misplaced ticket line", (t) => {
  const config = { pr: { "ticket-prefix": "ABC" } };
  const cases = [
    ["Ticket: none", /"Ticket: none" is not a ticket line\. Write "Ticket: ABC-123", or delete the line/],
    ["Ticket: XYZ-12", /"Ticket: XYZ-12" is not a ticket line/],
  ];
  for (const [ticket, expected] of cases) {
    assert.match(checkBody(t, body({ evidence: PAIR, ticket }), { config }).stdout, expected);
  }
  const late = `${body({ evidence: PAIR })}\n\nTicket: ABC-12`;
  assert.match(checkBody(t, late, { config }).stdout, /"Ticket: ABC-12" is not the description's first line/);
});

test("pr-body ignores a ticket line inside a code block", (t) => {
  const prBody = body({ evidence: `${PAIR}\n\n\`\`\`text\nTicket: <PREFIX>-<n> on the first line\n\`\`\`` });
  assert.equal(checkBody(t, prBody).stdout.trim(), BODY_OK);
});

test("pr-body warns on a ticket line when the repo has no ticket prefix", (t) => {
  const { stdout, status } = checkBody(t, body({ evidence: PAIR, ticket: "Ticket: ABC-12" }));
  assert.match(stdout, /::warning title=pr-body::Ticket: .*\.standard\/config\.json sets no pr\.ticket-prefix.* Delete the line\./);
  assert.equal(status, 0);
});

function checkTitle(t, title, pr = {}) {
  return checkPullRequest(t, pullRequestRepo(t), { title, ...pr }, ["pr-title"]);
}

test("pr-title fails a title that breaks the subject rules", (t) => {
  const { stdout, status } = checkTitle(t, "fixed stuff.");
  assert.match(stdout, /::error title=pr-title::fixed stuff\.: Subject ends with a period\. Drop it\. The title becomes the squash commit's subject, which the push to develop checks\./);
  assert.match(stdout, /::error title=pr-title::fixed stuff\.: Subject does not start with a capital letter/);
  assert.equal(status, 1);
});

test("pr-title passes a good title", (t) => {
  const { stdout, status } = checkTitle(t, "Accept a Before/After table as evidence");
  assert.equal(stdout.trim(), "pr-title: OK (#123)");
  assert.equal(status, 0);
});

test("pr-title counts the squash suffix, so a 78-character title fails as #123", (t) => {
  const title = `Add ${"x".repeat(70)} now`;
  assert.equal(title.length, 78);
  const { stdout, status } = checkTitle(t, title);
  assert.match(stdout, /::error title=pr-title::.*Subject is 85 characters with the " \(#123\)" the squash adds; keep it to 80 or fewer\./);
  assert.equal(status, 1);
  const fits = `Add ${"x".repeat(65)} now`;
  assert.equal(`${fits} (#123)`.length, 80);
  assert.equal(checkTitle(t, fits).status, 0);
});

test("pr-title fails a Dependabot title like any other, since its squash subject meets the same push check", (t) => {
  const title = `Bump the npm group across ${"1".repeat(2)} directories with ${"many ".repeat(12)}updates`;
  const { stdout, status } = checkTitle(t, title, { author: "dependabot[bot]" });
  assert.match(stdout, /::error title=pr-title::.*keep it to 80 or fewer/);
  assert.equal(status, 1);
});

const SCREENSHOTS = { pr: { screenshots: { when: ["apps/web/**", "packages/ui/**"], uploader: "scripts/upload-evidence.mjs" } } };

function checkScreenshot(t, changed, evidence, config = SCREENSHOTS) {
  const repo = pullRequestRepo(t, { base: { ".standard/config.json": config }, head: { [changed]: "x" } });
  return checkPullRequest(t, repo, { body: body({ evidence }) }, ["pr-screenshot"]);
}

test("pr-screenshot warns when a UI change has no screenshot in Evidence, naming the uploader", (t) => {
  const { stdout, status } = checkScreenshot(t, "apps/web/src/page.tsx", PAIR);
  assert.equal(
    stdout.trim(),
    "::warning title=pr-screenshot::Evidence: Evidence has no screenshot, but the PR changes apps/web/src/page.tsx. Upload one with scripts/upload-evidence.mjs.",
  );
  assert.equal(status, 0);
});

test("pr-screenshot globs match dotfiles and dot folders, and keep * inside one folder", (t) => {
  for (const changed of ["apps/web/.env.example", "apps/web/.storybook/main.ts", "packages/ui/src/.hidden/a.tsx", "apps/web/[id]/(group)/page.tsx", "apps/web/a\nb/page.tsx"]) {
    assert.match(checkScreenshot(t, changed, PAIR).stdout, /::warning title=pr-screenshot::Evidence: Evidence has no screenshot, but the PR changes apps\/web\/|packages\/ui\//, changed);
  }
  const config = { pr: { screenshots: { when: ["apps/*/page.tsx", "**/*.css"], uploader: "scripts/upload-evidence.mjs" } } };
  assert.match(checkScreenshot(t, "apps/web/page.tsx", PAIR, config).stdout, /the PR changes apps\/web\/page\.tsx/);
  assert.match(checkScreenshot(t, "styles.css", PAIR, config).stdout, /the PR changes styles\.css/);
  assert.equal(checkScreenshot(t, "apps/web/src/page.tsx", PAIR, config).stdout.trim(), "pr-screenshot: OK (#123)");
});

test("pr-screenshot skips files a ! entry in when excludes, and needs one entry that includes", (t) => {
  const config = (when) => ({ pr: { screenshots: { when, uploader: "scripts/upload-evidence.mjs" } } });
  const excluding = config(["apps/web/**", "!apps/web/**/*.test.tsx", "!apps/web/docs/**"]);
  assert.equal(checkScreenshot(t, "apps/web/src/page.test.tsx", PAIR, excluding).stdout.trim(), "pr-screenshot: OK (#123)");
  assert.equal(checkScreenshot(t, "apps/web/docs/guide.md", PAIR, excluding).stdout.trim(), "pr-screenshot: OK (#123)");
  assert.match(checkScreenshot(t, "apps/web/src/page.tsx", PAIR, excluding).stdout, /the PR changes apps\/web\/src\/page\.tsx/);
  const { stderr, status } = checkScreenshot(t, "apps/web/src/page.tsx", PAIR, config(["!apps/web/docs/**"]));
  assert.match(stderr, /pr\.screenshots\.when must list at least one glob that does not start with "!"/);
  assert.equal(status, 1);
});

test("pr-screenshot does not ask for a screenshot for a UI file no page renders", (t) => {
  const unrendered = [
    "apps/web/.oxlintrc.json",
    "apps/web/.oxfmtrc.jsonc",
    "apps/web/tsconfig.json",
    "apps/web/tsconfig.build.json",
    "apps/web/src/page.test.tsx",
    "packages/ui/src/__tests__/button.tsx",
  ];
  for (const changed of unrendered) assert.equal(checkScreenshot(t, changed, PAIR).stdout.trim(), "pr-screenshot: OK (#123)", changed);
  for (const changed of ["apps/web/package.json", "apps/web/app/test/page.tsx", "apps/web/app/scripts/page.tsx", "apps/web/src/tsconfig-panel.tsx", "apps/web/src/scripts.tsx", "apps/web/src/testimonials/card.tsx"]) {
    assert.match(checkScreenshot(t, changed, PAIR).stdout, /::warning title=pr-screenshot::/, changed);
  }
  const repo = pullRequestRepo(t, { base: { ".standard/config.json": SCREENSHOTS }, head: { "apps/web/.oxlintrc.json": "x", "apps/web/src/page.tsx": "x" } });
  assert.match(checkPullRequest(t, repo, { body: body({ evidence: PAIR }) }, ["pr-screenshot"]).stdout, /but the PR changes apps\/web\/src\/page\.tsx\. Upload/);
});

test("pr-screenshot accepts a UI change whose Evidence embeds a screenshot", (t) => {
  const evidence = `${PAIR}\n\n![after](https://example.com/b.png)`;
  assert.equal(checkScreenshot(t, "packages/ui/src/button.tsx", evidence).stdout.trim(), "pr-screenshot: OK (#123)");
});

test("pr-screenshot does not ask for a screenshot when the PR leaves the UI alone", (t) => {
  assert.equal(checkScreenshot(t, "apps/api/src/app.ts", PAIR).stdout.trim(), "pr-screenshot: OK (#123)");
});

test("pr-screenshot does not apply without pr.screenshots", (t) => {
  const { stdout } = checkScreenshot(t, "apps/web/src/page.tsx", PAIR, {});
  assert.equal(stdout.trim(), "pr-screenshot: skipped, .standard/config.json sets no pr.screenshots");
});

const BASELINE = ".standard/baselines/commit-subject.json";

function checkGrowth(t, files) {
  return checkPullRequest(t, pullRequestRepo(t, files), {}, ["baseline-growth"]);
}

test("baseline-growth fails a PR that grows a baseline", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: { [BASELINE]: { "a.mjs": ["one"] } },
    head: { [BASELINE]: { "a.mjs": ["one", "two"] } },
  });
  assert.match(stdout, /::error title=baseline-growth::\.standard\/baselines\/commit-subject\.json: This PR grows .* from 1 to 2 entries\. A baseline only shrinks\./);
  assert.equal(status, 1);
});

test("baseline-growth fails a PR that creates a baseline for an adopted check", (t) => {
  const { stdout, status } = checkGrowth(t, { head: { [BASELINE]: { "a.mjs": ["one"] } } });
  assert.match(stdout, /This PR creates \.standard\/baselines\/commit-subject\.json with 1 entries\. A baseline starts only in the PR that removes commit-subject from \.standard\/config\.json pending\./);
  assert.equal(status, 1);
});

const pinned = (version) => ({ "package.json": { devDependencies: { "@mapringg/standard": `github:mapringg/standard#v${version}` } } });

test("baseline-growth fails a PR that adds to pending", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: pinned("0.2.0"),
    head: { ...pinned("0.2.0"), ".standard/config.json": { pending: ["commit-subject"] } },
  });
  assert.match(stdout, /::error title=baseline-growth::pending commit-subject: \.standard\/config\.json adds "commit-subject" to pending\. pending only shrinks/);
  assert.equal(status, 1);
});

test("baseline-growth lets a version bump stage only the checks that version added", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: pinned("0.1.0"),
    head: { ...pinned("0.2.0"), ".standard/config.json": { pending: ["pr-body", "commit-subject"] } },
  });
  assert.doesNotMatch(stdout, /pending pr-body/);
  assert.match(stdout, /pending commit-subject: \.standard\/config\.json adds "commit-subject" to pending/);
  assert.equal(status, 1);
});

test("baseline-growth lets the bump to 0.14.13 stage client-data, so a repo can start its baseline in a later PR", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: pinned("0.14.12"),
    head: { ...pinned("0.14.13"), ".standard/config.json": { pending: ["client-data"] } },
  });
  assert.equal(stdout.trim(), "baseline-growth: OK (#123)");
  assert.equal(status, 0);
});

test("baseline-growth lets the bump to 0.14.14 stage route-await", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: pinned("0.14.13"),
    head: { ...pinned("0.14.14"), ".standard/config.json": { pending: ["route-await"] } },
  });
  assert.equal(stdout.trim(), "baseline-growth: OK (#123)");
  assert.equal(status, 0);
});

test("baseline-growth lets the bump to 0.14.15 stage use-promise", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: pinned("0.14.14"),
    head: { ...pinned("0.14.15"), ".standard/config.json": { pending: ["use-promise"] } },
  });
  assert.equal(stdout.trim(), "baseline-growth: OK (#123)");
  assert.equal(status, 0);
});

test("baseline-growth lets the PR that first installs the standard list anything as pending", (t) => {
  const { stdout, status } = checkGrowth(t, {
    head: { ...pinned("0.2.0"), ".standard/config.json": { pending: ["commit-subject", "pr-body"] } },
  });
  assert.equal(stdout.trim(), "baseline-growth: OK (#123)");
  assert.equal(status, 0);
});

test("baseline-growth cannot be pending, since it guards pending", (t) => {
  const { stderr, status } = checkGrowth(t, { head: { ".standard/config.json": { pending: ["baseline-growth"] } } });
  assert.match(stderr, /pending names baseline-growth, which guards pending itself/);
  assert.notEqual(status, 0);
});

test("baseline-growth refuses an upgrade exception when the base pin cannot be read", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: { "package.json": { devDependencies: { "@mapringg/standard": "github:mapringg/standard#develop" } } },
    head: { ...pinned("0.2.0"), ".standard/config.json": { pending: ["pr-body"] } },
  });
  assert.match(stdout, /pending pr-body: \.standard\/config\.json adds "pr-body" to pending/);
  assert.equal(status, 1);
});

test("baseline-growth refuses an upgrade exception for a check newer than the head pin", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: pinned("0.1.0"),
    head: { ...pinned("0.1.0"), ".standard/config.json": { pending: ["pr-body"] } },
  });
  assert.match(stdout, /pending pr-body/);
  assert.equal(status, 1);
});

function symlinkedHead(t, link, target, files) {
  const repo = pullRequestRepo(t, { base: pinned("0.2.0") });
  write(repo.cwd, files);
  symlinkSync(target, join(repo.cwd, link));
  git(repo.cwd, "add", "-A");
  git(repo.cwd, "commit", "-q", "--no-verify", "-m", "Point the config somewhere else");
  return { ...repo, head: git(repo.cwd, "rev-parse", "HEAD") };
}

test("a symlinked .standard/config.json fails instead of hiding pending from the guard", (t) => {
  const repo = symlinkedHead(t, ".standard/config.json", "../elsewhere.json", {
    "elsewhere.json": { pending: ["commit-subject"] },
    ".standard/baselines/.keep": "",
  });
  const { stderr, status } = checkPullRequest(t, repo, {}, ["baseline-growth"]);
  assert.match(stderr, /\.standard\/config\.json is a symlink/);
  assert.notEqual(status, 0);

  git(repo.cwd, "switch", "-q", "--detach", repo.base);
  const guarded = checkPullRequest(t, repo, {}, ["baseline-growth"]);
  assert.match(guarded.stdout, /::error title=baseline-growth::\.standard\/config\.json: \.standard\/config\.json is a symlink\. Make it a regular file/);
  assert.equal(guarded.status, 1);
});

test("baseline-growth fails a head whose .standard folder is a symlink", (t) => {
  const repo = symlinkedHead(t, ".standard", "elsewhere", { "elsewhere/config.json": { pending: ["commit-subject"] } });
  git(repo.cwd, "switch", "-q", "--detach", repo.base);
  const { stdout, status } = checkPullRequest(t, repo, {}, ["baseline-growth"]);
  assert.match(stdout, /::error title=baseline-growth::\.standard: \.standard is a symlink/);
  assert.equal(status, 1);
});

test("baseline-growth reads pending from a base that still has standard.json, so moving the config adds nothing", (t) => {
  const pending = { pending: ["commit-subject"] };
  const moved = checkGrowth(t, {
    base: { ...pinned("0.4.0"), "standard.json": pending },
    head: { ...pinned("0.5.0"), "standard.json": null, ".standard/config.json": pending },
  });
  assert.equal(moved.stdout.trim(), "baseline-growth: OK (#123)");
  assert.equal(moved.status, 0);

  const grown = checkGrowth(t, {
    base: { ...pinned("0.4.0"), "standard.json": pending },
    head: { ...pinned("0.5.0"), "standard.json": null, ".standard/config.json": { pending: ["commit-subject", "pr-body"] } },
  });
  assert.match(grown.stdout, /pending pr-body: \.standard\/config\.json adds "pr-body" to pending/);
  assert.equal(grown.status, 1);
});

test("baseline-growth fails a symlinked baseline", (t) => {
  const repo = pullRequestRepo(t, { base: { "counts.json": { "a.mjs": ["one"] } } });
  mkdirSync(join(repo.cwd, ".standard/baselines"), { recursive: true });
  symlinkSync("../../counts.json", join(repo.cwd, BASELINE));
  git(repo.cwd, "add", "-A");
  git(repo.cwd, "commit", "-q", "--no-verify", "-m", "Link the baseline to another file");
  const head = git(repo.cwd, "rev-parse", "HEAD");
  const { stdout, status } = checkPullRequest(t, { ...repo, head }, {}, ["baseline-growth"]);
  assert.match(stdout, /\.standard\/baselines\/commit-subject\.json is a symlink/);
  assert.equal(status, 1);
});

test("baseline-growth passes the PR that adopts a check and starts its baseline", (t) => {
  const { stdout, status } = checkGrowth(t, {
    base: { ".standard/config.json": { pending: ["commit-subject"] } },
    head: { ".standard/config.json": { pending: [] }, [BASELINE]: { "a.mjs": ["one"] } },
  });
  assert.equal(stdout.trim(), "baseline-growth: OK (#123)");
  assert.equal(status, 0);
});

test("baseline-growth passes a baseline that shrinks, keeps its size, or is deleted", (t) => {
  const base = { [BASELINE]: { "a.mjs": ["one", "two"] } };
  for (const after of [{ "a.mjs": ["one"] }, { "b.mjs": ["one", "two"] }, null]) {
    const { stdout, status } = checkGrowth(t, { base, head: { [BASELINE]: after } });
    assert.equal(stdout.trim(), "baseline-growth: OK (#123)");
    assert.equal(status, 0);
  }
});

test("a pull_request event runs commit, pull request and tree checks in one process", (t) => {
  const repo = pullRequestRepo(t, { base: WIRED });
  const { stdout, status } = checkPullRequest(t, repo, { body: GOOD_BODY });
  assert.equal(
    stdout.trim(),
    [
      "commit-subject: OK (1 commit(s))",
      "pr-title: OK (#123)",
      "pr-body: OK (#123)",
      "pr-screenshot: skipped, .standard/config.json sets no pr.screenshots",
      "pr-size: size:XS, 1 changed line(s) (#123)",
      "baseline-growth: OK (#123)",
      "wiring: OK",
      "dead-code: OK",
      "duplicates: skipped, git tracks no TypeScript source to scan",
      "typecheck: skipped, git tracks no tsconfig.json",
      "tests: OK",
      "pr-tests: OK (#123)",
      "boundaries: skipped, git tracks no JavaScript or TypeScript source",
      "banned: OK",
      "react: skipped, no tracked package.json declares react",
      "client-data: skipped, no tracked package.json declares react",
      "route-await: skipped, no tracked package.json declares next",
      "use-promise: skipped, no tracked package.json declares react",
      "no-comments: OK",
    ].join("\n"),
  );
  assert.equal(status, 0);
});

test("a push event skips the pull request checks", (t) => {
  const repo = pullRequestRepo(t, { base: WIRED });
  const { stdout, status } = checkEvent(t, repo.cwd, { ref: "refs/heads/feature", before: repo.base, after: repo.head });
  assert.match(stdout, /^pr-title: skipped, this run has no pull request to check$/m);
  assert.match(stdout, /^baseline-growth: skipped, this run has no pull request to check$/m);
  assert.equal(status, 0);
});

function fakeGh(t, pr) {
  const bin = tempDir(t, "bin");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$*" > "${join(bin, "args")}"\ncat <<'JSON'\n${JSON.stringify(pr)}\nJSON\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}` };
}

function ghPullRequest(repo, fields) {
  return {
    number: 7,
    title: "Add the pull request checks",
    body: GOOD_BODY,
    author: { login: "someone", is_bot: false },
    baseRefName: "develop",
    baseRefOid: repo.base,
    headRefName: "feature",
    headRefOid: repo.head,
    additions: 1,
    deletions: 0,
    ...fields,
  };
}

test("check --pr reads the pull request through gh and runs the same checks", (t) => {
  const repo = pullRequestRepo(t);
  const env = fakeGh(t, ghPullRequest(repo, { title: "fixed stuff" }));
  const { stdout, status } = standard(repo.cwd, ["check", "--pr", "7"], { env });
  assert.match(stdout, /^commit-subject: OK \(1 commit\(s\)\)$/m);
  assert.match(stdout, /^pr-title: fixed stuff: Subject does not start with a capital letter\./m);
  assert.match(stdout, /^pr-body: OK \(#7\)$/m);
  assert.equal(status, 1);
});

test("check --pr fails a Dependabot title that breaks the subject rules", (t) => {
  const repo = pullRequestRepo(t);
  const env = fakeGh(t, ghPullRequest(repo, { title: "bump x", author: { login: "app/dependabot", is_bot: true } }));
  const { stdout, status } = standard(repo.cwd, ["check", "pr-title", "--pr", "7"], { env });
  assert.match(stdout, /^pr-title: bump x: Subject does not start with a capital letter/m);
  assert.equal(status, 1);
});

test("check --pr says how to fetch a head the clone lacks, and needs a number", (t) => {
  const repo = pullRequestRepo(t);
  const env = fakeGh(t, ghPullRequest(repo, { headRefOid: "2".repeat(40) }));
  const missing = standard(repo.cwd, ["check", "--pr", "7"], { env });
  assert.match(missing.stderr, /Commit 2{40} of pull request #7 is not in this clone\. Fetch it: git fetch origin develop feature/);
  assert.equal(missing.status, 1);
  for (const args of [["--pr"], ["--pr", "abc"]]) {
    assert.match(standard(repo.cwd, ["check", ...args]).stderr, /--pr needs a pull request number, such as --pr 12\./);
  }
});

test("the config fails on a bad pr key", (t) => {
  const cases = [
    [{ pr: { ticket: "ABC" } }, /unknown key "pr\.ticket"\. Known keys: pr\.ticket-prefix, pr\.screenshots\./],
    [{ pr: { "ticket-prefix": "abc-" } }, /pr\.ticket-prefix must be capital letters and digits/],
    [{ pr: { screenshots: { when: [], uploader: "x.mjs" } } }, /pr\.screenshots\.when must list at least one glob/],
    [{ pr: { screenshots: { when: ["apps/web/**"], uploader: "/tmp/x.mjs" } } }, /pr\.screenshots\.uploader must be a path relative to the repository root/],
    [{ pr: { screenshots: { when: ["apps/web/**"] } } }, /pr\.screenshots\.uploader must be a path/],
  ];
  for (const [config, expected] of cases) {
    const { stderr, status } = standard(tempRepo(t, config), ["check"]);
    assert.match(stderr, expected);
    assert.equal(status, 1);
  }
});
