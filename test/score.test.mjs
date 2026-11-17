import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";

import { git, installPackage, standard, tempDir, tempRepo, WIRED, write } from "./helpers.mjs";

function repoWith(t, files, config) {
  const cwd = tempRepo(t);
  write(cwd, { ...files, ...(config ? { ".standard/config.json": config } : {}) });
  git(cwd, "add", "-A");
  installPackage(cwd);
  assert.equal(standard(cwd, ["install"]).status, 0);
  return cwd;
}

function scoreJson(cwd, args, env) {
  const { stdout, stderr, status } = standard(cwd, ["score", "--json", ...args], { env });
  assert.equal(stderr, "");
  return { status, repos: JSON.parse(stdout).repos };
}

const statuses = (repo) => Object.fromEntries(repo.cells.map((cell) => [cell.row, cell.status]));

const GOOD_SETTINGS = {
  full_name: "owner/repo-a",
  default_branch: "develop",
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "BLANK",
  delete_branch_on_merge: true,
};

const SQUASH_ONLY = { required_approving_review_count: 0, allowed_merge_methods: ["squash"] };

const GOOD_GITHUB = {
  "repos/{owner}/{repo}": GOOD_SETTINGS,
  "repos/{owner}/{repo}/rules/branches/develop": [
    { type: "deletion", ruleset_id: 1 },
    { type: "pull_request", ruleset_id: 1, parameters: SQUASH_ONLY },
  ],
  "repos/{owner}/{repo}/rules/branches/main": [
    { type: "deletion", ruleset_id: 2 },
    { type: "non_fast_forward", ruleset_id: 2 },
  ],
};

const httpError = (status, message) => ({ status, message });

const CLASSIC = { allow_deletions: { enabled: false }, allow_force_pushes: { enabled: false } };
const CLASSIC_PULL_REQUEST = {
  ...CLASSIC,
  required_pull_request_reviews: { dismiss_stale_reviews: false, require_code_owner_reviews: false, required_approving_review_count: 0 },
};
const NOT_PROTECTED = httpError(404, "Branch not protected");

/**
 * Answers each `gh api` path from `responses` the way gh prints it: JSON on stdout, `--slurp` wrapping
 * the one page in an array, a string as is, and an HTTP error as its body on stdout, "gh: <message>
 * (HTTP <status>)" on stderr and exit 1.
 */
function fakeGh(t, responses, tags = ["v0.3.0", "v0.4.0", "latest"]) {
  const bin = tempDir(t, "bin");
  const calls = join(bin, "calls");
  const script = `#!/usr/bin/env node
const { appendFileSync } = process.getBuiltinModule("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
const responses = ${JSON.stringify({ ...responses, "repos/mapringg/standard/tags": tags.join("\n") })};
const path = args.find((arg) => arg.startsWith("repos/"));
const response = Object.hasOwn(responses, path) ? responses[path] : { status: 404, message: "Not Found" };
if (typeof response === "string") {
  console.log(response);
} else if (response.status) {
  console.log(JSON.stringify({ message: response.message, status: String(response.status) }));
  console.error(\`gh: \${response.message} (HTTP \${response.status})\`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(args.includes("--slurp") ? [response] : response));
}
`;
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return {
    env: { PATH: `${bin}:${process.env.PATH}` },
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []),
  };
}

function remoteSettings(t, github) {
  const gh = fakeGh(t, { ...GOOD_GITHUB, ...github });
  const { status, repos } = scoreJson(repoWith(t, WIRED), ["--remote"], gh.env);
  return { status, settings: repos[0].cells.find((cell) => cell.row === "settings"), gh };
}

const DEVELOP_RULESET =
  `echo '{"name":"standard develop pull_request","target":"branch","enforcement":"active",` +
  `"conditions":{"ref_name":{"include":["refs/heads/develop"],"exclude":[]}},` +
  `"rules":[{"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":false,` +
  `"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false,` +
  `"allowed_merge_methods":["squash"]}}]}' | gh api -X POST repos/owner/repo-a/rulesets --input -`;

const mainRuleset = (rule) =>
  `echo '{"name":"standard main ${rule}","target":"branch","enforcement":"active",` +
  `"conditions":{"ref_name":{"include":["refs/heads/main"],"exclude":[]}},` +
  `"rules":[{"type":"${rule}"}]}' | gh api -X POST repos/owner/repo-a/rulesets --input -`;

test("score prints one column for this repo and ends with its count", (t) => {
  const cwd = repoWith(t, { ...WIRED, "scripts/check-commit-msg.mjs": "old" });
  const name = basename(cwd);
  const { stdout, status } = standard(cwd, ["score"]);
  assert.equal(
    stdout,
    [
      `                   ${name}`,
      "wiring",
      "  retired          fail",
      "  ci               ok",
      "  pin              ok",
      "  installed        ok",
      "  prepare          ok",
      "  config-file      ok",
      "  claude-md        ok",
      "  hooks            ok",
      "  config           ok",
      "checks",
      "  commit-subject   on",
      "  pr-title         on",
      "  pr-body          on",
      "  pr-screenshot    n/a",
      "  pr-size          on",
      "  baseline-growth  on",
      "  wiring           on",
      "  dead-code        on",
      "  duplicates       n/a",
      "  typecheck        n/a",
      "  tests            on",
      "  pr-tests         on",
      "  boundaries       on",
      "  banned           on",
      "  react            n/a",
      "  no-comments      on",
      "",
      `retired in ${name}: Delete scripts/check-commit-msg.mjs, which the commit-subject check replaces.`,
      `pr-screenshot in ${name}: n/a, .standard/config.json sets no pr.screenshots`,
      `duplicates in ${name}: n/a, git tracks no TypeScript source to scan`,
      `typecheck in ${name}: n/a, git tracks no tsconfig.json`,
      `react in ${name}: n/a, no tracked package.json declares react`,
      "",
      `${name}: 20 of 21 pass`,
      "",
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("an n/a row leaves the denominator, and a row that applies joins it", (t) => {
  const { status, repos } = scoreJson(repoWith(t, WIRED), []);
  assert.deepEqual(
    repos[0].cells.find((cell) => cell.row === "pr-screenshot"),
    { group: "checks", row: "pr-screenshot", status: "n/a", pass: null, notes: [".standard/config.json sets no pr.screenshots"] },
  );
  assert.deepEqual([repos[0].passing, repos[0].total], [20, 20]);
  assert.equal(status, 0);

  const screenshots = { pr: { screenshots: { when: ["web/**"], uploader: "scripts/upload.mjs" } } };
  const applied = scoreJson(repoWith(t, WIRED, screenshots), []);
  assert.equal(statuses(applied.repos[0])["pr-screenshot"], "on");
  assert.deepEqual([applied.repos[0].passing, applied.repos[0].total], [21, 21]);
});

test("pending stays in the denominator and fails", (t) => {
  const { status, repos } = scoreJson(repoWith(t, { ...WIRED, "scripts/check-pr-convention.mjs": "old" }, { pending: ["pr-body"] }), []);
  assert.equal(statuses(repos[0])["pr-body"], "pending");
  assert.equal(statuses(repos[0]).retired, "ok");
  assert.deepEqual([repos[0].passing, repos[0].total], [20, 21]);
  assert.equal(status, 1);
});

test("a pending check shows pending and fails even where it would not apply", (t) => {
  const { status, repos } = scoreJson(repoWith(t, WIRED, { pending: ["pr-screenshot"] }), []);
  assert.deepEqual(repos[0].cells.find((cell) => cell.row === "pr-screenshot"), {
    group: "checks",
    row: "pr-screenshot",
    status: "pending",
    pass: false,
    notes: [".standard/config.json pending lists it, so it does not run."],
  });
  assert.deepEqual([repos[0].passing, repos[0].total], [20, 21]);
  assert.equal(status, 1);
});

test("a pending list the runner refuses fails the config row with the runner's message", (t) => {
  const cases = [
    [{ pending: ["typo"] }, '.standard/config.json pending names "typo", which is not a check in this version. Checks: commit-subject, pr-title, pr-body, pr-screenshot, pr-size, baseline-growth, wiring, dead-code, duplicates, typecheck, tests, pr-tests, boundaries, banned, react, no-comments.'],
    [{ pending: ["baseline-growth"] }, ".standard/config.json pending names baseline-growth, which guards pending itself. Remove it from pending."],
  ];
  for (const [config, message] of cases) {
    const cwd = repoWith(t, WIRED, config);
    const check = standard(cwd, ["check"]);
    assert.equal(check.stderr, `standard: ${message}\n`);
    assert.equal(check.status, 1);
    const { status, repos } = scoreJson(cwd, []);
    assert.deepEqual(repos[0].cells.find((cell) => cell.row === "config"), {
      group: "wiring",
      row: "config",
      status: "fail",
      pass: false,
      notes: [message],
    });
    assert.equal(status, 1);
  }
});

test("hooks fails until standard install writes the three shims and unsets core.hooksPath", (t) => {
  const cwd = tempRepo(t);
  write(cwd, WIRED);
  git(cwd, "add", "-A");
  const hooks = () => scoreJson(cwd, []).repos[0].cells.find((cell) => cell.row === "hooks");
  assert.deepEqual(hooks().notes, [
    "commit-msg, pre-commit, pre-push are not the standard's hooks. Run pnpm install, so prepare runs standard install and writes them.",
  ]);

  standard(cwd, ["install"]);
  writeFileSync(join(cwd, ".git/hooks/pre-push"), "#!/bin/sh\nexit 0\n");
  git(cwd, "config", "core.hooksPath", ".husky");
  assert.deepEqual(hooks().notes, [
    "pre-push is not the standard's hook. Run pnpm install, so prepare runs standard install and writes them.",
    "core.hooksPath is .husky, so git skips the standard's hooks. Run standard install, which unsets it.",
  ]);

  standard(cwd, ["install"]);
  assert.deepEqual(hooks(), { group: "wiring", row: "hooks", status: "ok", pass: true, notes: [] });
});

test("installed fails when package.json pins a version other than the one that runs", (t) => {
  const pinned = { ...WIRED, "package.json": { scripts: { prepare: "standard install" }, devDependencies: { "@mapringg/standard": "9.9.9" } } };
  const cwd = repoWith(t, pinned);
  const fix = "Run pnpm install, so the installed 0.14.4 becomes the @mapringg/standard 9.9.9 that package.json pins.";
  assert.equal(standard(cwd, ["check", "wiring"]).stdout, `wiring: installed: ${fix}\n`);
  const { status, repos } = scoreJson(cwd, []);
  assert.deepEqual(repos[0].cells.find((cell) => cell.row === "installed").notes, [fix]);
  assert.equal(status, 1);
});

test("a check the pinned version predates is absent, and so is every check without the package", (t) => {
  const old = { ...WIRED, "package.json": { scripts: { prepare: "standard install" }, devDependencies: { "@mapringg/standard": "0.3.0" } } };
  const pinned = scoreJson(repoWith(t, old), []).repos[0];
  assert.deepEqual(pinned.cells.find((cell) => cell.row === "wiring").notes, ["Added in 0.4.0; the repo pins 0.3.0."]);
  assert.equal(statuses(pinned)["pr-size"], "on");

  const bare = scoreJson(repoWith(t, { "README.md": "nothing installed" }), []).repos[0];
  assert.deepEqual(statuses(bare), {
    retired: "ok",
    ci: "fail",
    pin: "fail",
    installed: "ok",
    prepare: "fail",
    "config-file": "fail",
    "claude-md": "ok",
    hooks: "ok",
    config: "ok",
    "commit-subject": "absent",
    "pr-title": "absent",
    "pr-body": "absent",
    "pr-screenshot": "n/a",
    "pr-size": "absent",
    "baseline-growth": "absent",
    wiring: "absent",
    "dead-code": "n/a",
    duplicates: "n/a",
    typecheck: "n/a",
    tests: "n/a",
    "pr-tests": "absent",
    boundaries: "n/a",
    banned: "absent",
    react: "n/a",
    "no-comments": "absent",
  });
  assert.deepEqual([bare.passing, bare.total], [5, 18]);
});

test("a baseline file does not make wiring debt, since wiring keeps no baseline", (t) => {
  const { repos } = scoreJson(repoWith(t, { ...WIRED, ".standard/baselines/wiring.json": { wiring: ["ci"] } }), []);
  assert.equal(statuses(repos[0]).wiring, "on");
});

test("several paths print a matrix with a column and a count per repo", (t) => {
  const wired = repoWith(t, WIRED);
  const bare = repoWith(t, { ...WIRED, "CLAUDE.md": "@AGENTS.md" });
  const [a, b] = [basename(wired), basename(bare)];
  const { stdout, status } = standard(wired, ["score", wired, bare]);
  const lines = stdout.trimEnd().split("\n");
  assert.match(lines[0], new RegExp(`^ +${a}  ${b}$`));
  assert.match(stdout, /^ {2}claude-md {8}ok {2,}fail$/m);
  assert.match(stdout, new RegExp(`^claude-md in ${b}: Make CLAUDE.md exactly "@AGENTS.md" and a newline`, "m"));
  assert.doesNotMatch(stdout, new RegExp(`claude-md in ${a}`));
  assert.deepEqual(lines.slice(-2), [`${a}: 20 of 20 pass`, `${b}: 19 of 20 pass`]);
  assert.equal(status, 1);
});

test("a note that holds for several repos prints once and names them", (t) => {
  const [a, b] = [repoWith(t, { "README.md": "a" }), repoWith(t, { "README.md": "b" })];
  const { stdout } = standard(a, ["score", a, b]);
  const names = `${basename(a)}, ${basename(b)}`;
  assert.match(stdout, new RegExp(`^pr-size in ${names}: The repo does not install @mapringg/standard\\.$`, "m"));
  assert.match(stdout, new RegExp(`^pr-screenshot in ${names}: n/a, \\.standard/config\\.json sets no pr\\.screenshots$`, "m"));
  assert.equal(stdout.match(/^pr-size in /gm).length, 1);
});

test("several paths in JSON give one entry per repo, by folder name", (t) => {
  const wired = repoWith(t, WIRED);
  const other = repoWith(t, WIRED);
  const { status, repos } = scoreJson(tempDir(t, "elsewhere"), [wired, other]);
  assert.deepEqual(repos.map((repo) => repo.name), [basename(wired), basename(other)]);
  assert.deepEqual(repos.map((repo) => [repo.passing, repo.total]), [[20, 20], [20, 20]]);
  assert.equal(status, 0);
});

test("--remote reads each repo's GitHub settings through gh and names the fix for each drift", (t) => {
  const gh = fakeGh(t, {
    ...GOOD_GITHUB,
    "repos/{owner}/{repo}": { ...GOOD_SETTINGS, allow_merge_commit: true, squash_merge_commit_message: "COMMIT_MESSAGES" },
  });
  const [a, b] = [repoWith(t, WIRED), repoWith(t, WIRED)];
  const { status, repos } = scoreJson(a, ["--remote", a, b], gh.env);
  const reads = (cwd) => [
    { cwd, args: ["api", "repos/{owner}/{repo}"] },
    { cwd, args: ["api", "--paginate", "--slurp", "repos/{owner}/{repo}/rules/branches/develop"] },
    { cwd, args: ["api", "--paginate", "--slurp", "repos/{owner}/{repo}/rules/branches/main"] },
  ];
  assert.deepEqual(gh.calls(), [
    { cwd: a, args: ["api", "--paginate", "repos/mapringg/standard/tags", "--jq", ".[].name"] },
    ...reads(a),
    ...reads(b),
  ]);
  assert.deepEqual(
    repos[0].cells.filter((cell) => cell.group === "github"),
    [
      {
        group: "github",
        row: "settings",
        status: "fail",
        pass: false,
        notes: [
          "allow_merge_commit is true; expected false. Fix: gh api -X PATCH repos/owner/repo-a -F allow_merge_commit=false",
          'squash_merge_commit_message is "COMMIT_MESSAGES"; expected "BLANK". Fix: gh api -X PATCH repos/owner/repo-a -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=BLANK',
        ],
      },
      { group: "github", row: "current", status: "ok", pass: true, notes: [] },
    ],
  );
  assert.deepEqual([repos[0].passing, repos[0].total], [21, 22]);
  assert.equal(status, 1);
});

test("--remote passes a repo whose settings and rules all match", (t) => {
  const { status, settings } = remoteSettings(t, {});
  assert.deepEqual(settings, { group: "github", row: "settings", status: "ok", pass: true, notes: [] });
  assert.equal(status, 0);
});

test("--remote reports each repository setting that drifted with its PATCH", (t) => {
  const { settings } = remoteSettings(t, {
    "repos/{owner}/{repo}": {
      full_name: "owner/repo-a",
      default_branch: "main",
      allow_squash_merge: false,
      allow_merge_commit: false,
      allow_rebase_merge: true,
      squash_merge_commit_title: "COMMIT_OR_PR_TITLE",
      squash_merge_commit_message: "BLANK",
      delete_branch_on_merge: false,
    },
  });
  const patch = "gh api -X PATCH repos/owner/repo-a";
  assert.deepEqual(settings.notes, [
    `default_branch is "main"; expected "develop". Fix: ${patch} -f default_branch=develop`,
    `allow_squash_merge is false; expected true. Fix: ${patch} -F allow_squash_merge=true`,
    `allow_rebase_merge is true; expected false. Fix: ${patch} -F allow_rebase_merge=false`,
    `squash_merge_commit_title is "COMMIT_OR_PR_TITLE"; expected "PR_TITLE". Fix: ${patch} -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=BLANK`,
    `delete_branch_on_merge is false; expected true. Fix: ${patch} -F delete_branch_on_merge=true`,
  ]);
  assert.equal(settings.status, "fail");
});

test("--remote fails develop without a pull request rule and names the ruleset to create", (t) => {
  const { settings, gh } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/develop": [{ type: "deletion", ruleset_id: 1 }],
    "repos/{owner}/{repo}/branches/develop/protection": NOT_PROTECTED,
  });
  assert.deepEqual(settings.notes, [
    `develop pull_request rule is missing; expected an active ruleset or classic protection that requires a pull request. Fix: ${DEVELOP_RULESET}`,
  ]);
  assert.equal(settings.status, "fail");
  assert.ok(gh.calls().some((call) => call.args.includes("repos/{owner}/{repo}/branches/develop/protection")));
});

test("--remote fails develop when its pull request rules allow a merge method besides squash", (t) => {
  const { settings } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/develop": [
      { type: "pull_request", ruleset_id: 7, parameters: { allowed_merge_methods: ["merge", "squash", "rebase"] } },
      { type: "pull_request", ruleset_id: 8, parameters: { allowed_merge_methods: ["merge", "squash"] } },
    ],
  });
  assert.deepEqual(settings.notes, [
    'develop allowed_merge_methods is ["merge","squash"]; expected ["squash"]. Fix: https://github.com/owner/repo-a/settings/rules/7 https://github.com/owner/repo-a/settings/rules/8',
  ]);
  assert.equal(settings.status, "fail");
});

test("--remote counts a pull request rule without allowed_merge_methods as allowing every method", (t) => {
  const { settings } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/develop": [{ type: "pull_request", ruleset_id: 3, parameters: { required_approving_review_count: 2 } }],
  });
  assert.deepEqual(settings.notes, [
    'develop allowed_merge_methods is ["merge","squash","rebase"]; expected ["squash"]. Fix: https://github.com/owner/repo-a/settings/rules/3',
  ]);
});

test("--remote fails main without deletion and force-push rules", (t) => {
  const { settings } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/main": [],
    "repos/{owner}/{repo}/branches/main/protection": httpError(404, "Branch not found"),
  });
  assert.deepEqual(settings.notes, [
    `main deletion rule is missing; expected an active ruleset that blocks deletion. Fix: ${mainRuleset("deletion")}`,
    `main non_fast_forward rule is missing; expected an active ruleset that blocks force-push. Fix: ${mainRuleset("non_fast_forward")}`,
  ]);
  assert.equal(settings.status, "fail");
});

test("--remote accepts classic branch protection where no ruleset applies", (t) => {
  const { status, settings, gh } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/develop": [],
    "repos/{owner}/{repo}/rules/branches/main": [],
    "repos/{owner}/{repo}/branches/develop/protection": CLASSIC_PULL_REQUEST,
    "repos/{owner}/{repo}/branches/main/protection": CLASSIC,
  });
  assert.deepEqual(settings, { group: "github", row: "settings", status: "ok", pass: true, notes: [] });
  assert.equal(gh.calls().filter((call) => call.args.at(-1).endsWith("/protection")).length, 2);
  assert.equal(status, 0);
});

test("--remote fails classic protection that allows force-push on main", (t) => {
  const { settings } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/main": [],
    "repos/{owner}/{repo}/branches/main/protection": { ...CLASSIC, allow_force_pushes: { enabled: true } },
  });
  assert.deepEqual(settings.notes, [
    `main non_fast_forward rule is missing; expected an active ruleset that blocks force-push. Fix: ${mainRuleset("non_fast_forward")}`,
  ]);
});

test("--remote counts a classic protection flag GitHub leaves out as not blocking", (t) => {
  const { settings } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/main": [],
    "repos/{owner}/{repo}/branches/main/protection": {},
  });
  assert.deepEqual(settings.notes, [
    `main deletion rule is missing; expected an active ruleset that blocks deletion. Fix: ${mainRuleset("deletion")}`,
    `main non_fast_forward rule is missing; expected an active ruleset that blocks force-push. Fix: ${mainRuleset("non_fast_forward")}`,
  ]);
});

test("--remote reports the rules as unknown, not pass or fail, when the token cannot read them", (t) => {
  const plan = httpError(403, "Upgrade to GitHub Pro or make this repository public to enable this feature.");
  const { status, settings } = remoteSettings(t, {
    "repos/{owner}/{repo}/rules/branches/develop": plan,
    "repos/{owner}/{repo}/rules/branches/main": plan,
    "repos/{owner}/{repo}/branches/develop/protection": plan,
    "repos/{owner}/{repo}/branches/main/protection": plan,
  });
  const said = (path) => `gh api ${path} returned "gh: ${plan.message} (HTTP 403)".`;
  const unknown = (branch, rule) =>
    `${branch} ${rule} rule is unknown; ${said(`repos/{owner}/{repo}/rules/branches/${branch}`)} ${said(`repos/{owner}/{repo}/branches/${branch}/protection`)}`;
  assert.deepEqual(settings, {
    group: "github",
    row: "settings",
    status: "unknown",
    pass: null,
    notes: [
      unknown("develop", "pull_request"),
      unknown("main", "deletion"),
      unknown("main", "non_fast_forward"),
      `develop allowed_merge_methods is unknown; ${said("repos/{owner}/{repo}/rules/branches/develop")}`,
    ],
  });
  assert.equal(status, 0);
});

test("--remote still fails a drifted repository setting when the rules are unknown", (t) => {
  const { status, settings } = remoteSettings(t, {
    "repos/{owner}/{repo}": { ...GOOD_SETTINGS, delete_branch_on_merge: false },
    "repos/{owner}/{repo}/rules/branches/main": httpError(404, "Not Found"),
    "repos/{owner}/{repo}/branches/main/protection": httpError(404, "Not Found"),
  });
  assert.equal(settings.status, "fail");
  assert.equal(settings.notes.length, 3);
  assert.match(settings.notes[0], /^delete_branch_on_merge is false/);
  assert.match(settings.notes[1], /^main deletion rule is unknown; gh api .* returned "gh: Not Found \(HTTP 404\)"/);
  assert.equal(status, 1);
});

test("--remote fails closed when gh prints output it cannot parse", (t) => {
  for (const [path, output] of [
    ["repos/{owner}/{repo}", "<html>"],
    ["repos/{owner}/{repo}/rules/branches/develop", "not json"],
    ["repos/{owner}/{repo}/rules/branches/main", [{ ruleset_id: 2 }]],
  ]) {
    const { status, settings } = remoteSettings(t, { [path]: output });
    assert.equal(settings.status, "fail", path);
    assert.equal(settings.pass, false, path);
    assert.match(settings.notes[0], new RegExp(`^gh api ${path.replace(/[{}]/g, "\\$&")} printed (output that is not JSON|JSON of an unexpected shape)`), path);
    assert.equal(status, 1, path);
  }
});

test("--remote keeps develop merge methods unknown when classic protection requires a pull request but the rules are unreadable", (t) => {
  for (const error of [httpError(403, "Forbidden"), httpError(404, "Not Found")]) {
    const { status, settings } = remoteSettings(t, {
      "repos/{owner}/{repo}/rules/branches/develop": error,
      "repos/{owner}/{repo}/branches/develop/protection": CLASSIC_PULL_REQUEST,
    });
    assert.deepEqual(settings, {
      group: "github",
      row: "settings",
      status: "unknown",
      pass: null,
      notes: [
        `develop allowed_merge_methods is unknown; gh api repos/{owner}/{repo}/rules/branches/develop returned "gh: ${error.message} (HTTP ${error.status})".`,
      ],
    });
    assert.equal(status, 0);
  }
});

test("--remote fails closed on classic protection or pull request rules of the wrong shape", (t) => {
  const develop = "repos/{owner}/{repo}/rules/branches/develop";
  const classic = "repos/{owner}/{repo}/branches/develop/protection";
  const squash = { type: "pull_request", ruleset_id: 1, parameters: { allowed_merge_methods: ["squash"] } };
  const cases = [
    [classic, { [develop]: [], [classic]: { ...CLASSIC, required_pull_request_reviews: false } }],
    [classic, { [develop]: [], [classic]: { ...CLASSIC, required_pull_request_reviews: "off" } }],
    [classic, { [develop]: [], [classic]: { ...CLASSIC, required_pull_request_reviews: [] } }],
    [classic, { [develop]: [], [classic]: { ...CLASSIC, required_pull_request_reviews: { message: "bad" } } }],
    [classic, { [develop]: [], [classic]: { ...CLASSIC_PULL_REQUEST, allow_deletions: null } }],
    [classic, { [develop]: [], [classic]: { ...CLASSIC_PULL_REQUEST, allow_force_pushes: { enabled: "no" } } }],
    [develop, { [develop]: [squash, { type: "pull_request", ruleset_id: 2, parameters: false }] }],
    [develop, { [develop]: [{ type: "pull_request", ruleset_id: 1, parameters: null }] }],
    [develop, { [develop]: [{ type: "pull_request", ruleset_id: 1, parameters: { allowed_merge_methods: ["squash", "fast-forward"] } }] }],
    [develop, { [develop]: [{ type: "pull_request", parameters: { allowed_merge_methods: ["squash"] } }] }],
  ];
  for (const [path, github] of cases) {
    const { status, settings } = remoteSettings(t, github);
    const label = JSON.stringify(github);
    assert.deepEqual(settings.notes, [`gh api ${path} printed JSON of an unexpected shape, so the settings cannot be checked.`], label);
    assert.equal(settings.status, "fail", label);
    assert.equal(status, 1, label);
  }
});

test("--remote fails current when a newer release tag than the pin exists", (t) => {
  const gh = fakeGh(t, GOOD_GITHUB, ["v0.4.0", "v0.15.0", "v0.9.1", "v1.0.0-rc.1"]);
  const { status, repos } = scoreJson(repoWith(t, WIRED), ["--remote"], gh.env);
  assert.deepEqual(repos[0].cells.at(-1), {
    group: "github",
    row: "current",
    status: "fail",
    pass: false,
    notes: ["Bump @mapringg/standard to v0.15.0, the latest release; the repo pins 0.14.4."],
  });
  assert.equal(status, 1);
});

test("without --remote, score never calls gh", (t) => {
  const gh = fakeGh(t, GOOD_GITHUB);
  const { repos } = scoreJson(repoWith(t, WIRED), [], gh.env);
  assert.deepEqual(gh.calls(), []);
  assert.equal(repos[0].cells.some((cell) => cell.group === "github"), false);
});

test("score refuses an unknown option", (t) => {
  const { stderr, status } = standard(repoWith(t, WIRED), ["score", "--remot"]);
  assert.match(stderr, /^standard: Unknown option '--remot'/);
  assert.equal(status, 1);
});
