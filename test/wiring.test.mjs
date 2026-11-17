import assert from "node:assert/strict";
import { test } from "node:test";

import { git, installPackage, standard, tempRepo, WIRED, write } from "./helpers.mjs";

function wiredRepo(t, files = {}, config) {
  const cwd = tempRepo(t);
  const settings = config ? { ".standard/config.json": config } : {};
  write(cwd, Object.fromEntries(Object.entries({ ...WIRED, ...settings, ...files }).filter(([, content]) => content !== null)));
  git(cwd, "add", "-A");
  installPackage(cwd);
  return cwd;
}

function wiring(cwd) {
  return standard(cwd, ["check", "wiring"]);
}

function assertFails(cwd, line) {
  const { stdout, status } = wiring(cwd);
  assert.equal(stdout.trim(), `wiring: ${line}`);
  assert.equal(status, 1);
}

function assertPasses(cwd) {
  const { stdout, stderr, status } = wiring(cwd);
  assert.equal(stderr, "");
  assert.equal(stdout.trim(), "wiring: OK");
  assert.equal(status, 0);
}

const CI = WIRED[".github/workflows/ci.yml"];

function ci(text) {
  return { ".github/workflows/ci.yml": text };
}

function edit(...pairs) {
  let text = CI;
  for (let at = 0; at < pairs.length; at += 2) {
    assert.ok(text.includes(pairs[at]), `the workflow has ${pairs[at]}`);
    text = text.replace(pairs[at], pairs[at + 1]);
  }
  return ci(text);
}

test("a wired repo passes", (t) => {
  assertPasses(wiredRepo(t));
});

test("config-file fails until git tracks .standard/config.json, which passes as {}", (t) => {
  const cwd = wiredRepo(t, { ".standard/config.json": null });
  assertFails(cwd, ".standard/config.json: Commit .standard/config.json, even as {}, so the hooks know this repository uses the standard.");

  write(cwd, { ".standard/config.json": {} });
  assertFails(cwd, ".standard/config.json: Commit .standard/config.json, even as {}, so the hooks know this repository uses the standard.");

  git(cwd, "add", ".standard/config.json");
  assertPasses(cwd);
});

test("a retired script that is still tracked fails once its check is on", (t) => {
  const cwd = wiredRepo(t, { "scripts/check-commit-msg.mjs": "old" });
  assertFails(
    cwd,
    "scripts/check-commit-msg.mjs: Delete scripts/check-commit-msg.mjs, which the commit-subject check replaces.",
  );
});

test("a retired script passes while its check is pending, and when git does not track it", (t) => {
  assertPasses(wiredRepo(t, { "scripts/check-commit-msg.mjs": "old" }, { pending: ["commit-subject"] }));

  const cwd = wiredRepo(t);
  write(cwd, { "scripts/check-commit-msg.mjs": "untracked" });
  assertPasses(cwd);
});

test("a script several checks retire passes while any of them is pending", (t) => {
  const files = { "scripts/check-pr-convention.mjs": "old" };
  for (const owner of ["pr-title", "pr-body", "pr-screenshot"]) {
    assertPasses(wiredRepo(t, files, { pending: [owner] }));
  }
  assertFails(
    wiredRepo(t, files),
    "scripts/check-pr-convention.mjs: Delete scripts/check-pr-convention.mjs, which the pr-title check, the pr-body check and the pr-screenshot check replace.",
  );
});

test("subject-convention.mjs passes while commit-subject or a pull request check that imports it is pending", (t) => {
  const files = { "scripts/subject-convention.mjs": "old" };
  for (const owner of ["commit-subject", "pr-title", "pr-body", "pr-screenshot"]) {
    assertPasses(wiredRepo(t, files, { pending: [owner] }));
  }
  assertFails(
    wiredRepo(t, files),
    "scripts/subject-convention.mjs: Delete scripts/subject-convention.mjs, which the commit-subject check, the pr-title check, the pr-body check and the pr-screenshot check replace.",
  );
});

test("the merge script fails, since standard merge replaces it and pending cannot hold a command", (t) => {
  const { stdout, status } = wiring(wiredRepo(t, { "scripts/merge-pr.mjs": "old", "scripts/merge-pr.test.mjs": "old" }));
  assert.equal(
    stdout.trim(),
    [
      "wiring: scripts/merge-pr.mjs: Delete scripts/merge-pr.mjs, which standard merge replaces.",
      "wiring: scripts/merge-pr.test.mjs: Delete scripts/merge-pr.test.mjs, which standard merge replaces.",
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("ci passes a Check job that checks out full history and then runs standard check", (t) => {
  const shapes = [
    ci(CI),
    edit("on:\n  pull_request:\n", "on: [push, pull_request]\n", "      - ", "    - ", "      - ", "    - ", "      - ", "    - ", "      - ", "    - ", "        with:\n          fetch-depth: 0", "      with:\n        fetch-depth: 0"),
    edit("on:\n  pull_request:\n", "on: pull_request\n", "  check:\n    name: Check\n", "  Check:\n", "        with:\n          fetch-depth: 0", '        with: { fetch-depth: "0" }'),
    edit("  pull_request:\n", "  push:\n  pull_request:\n    branches: [develop, main]\n    types: [opened, synchronize, reopened, edited]\n"),
    edit("  pull_request:\n", "  pull_request:\n    branches: ['**', '!release/*']\n"),
    edit("  pull_request:\n", "  pull_request:\n    branches: [dev*, '!develop', develop]\n"),
    edit("  pull_request:\n", "  pull_request:\n    branches: ['**/develop']\n"),
    edit("  pull_request:\n", "  pull_request:\n    branches: ['**', '!**/release/*']\n"),
    edit("  pull_request:\n", "  pull_request:\n    branches-ignore: ['release/**']\n"),
    edit("      - run: pnpm exec standard check", "      - name: Run the standard\n        run: |\n          npx standard check\n        env:\n          GH_TOKEN: x"),
    edit("      - run: pnpm exec standard check", "      - run: pnpm standard check # the gate"),
    edit("      - run: pnpm exec standard check", "      - run: standard check"),
    edit("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    strategy:\n      fail-fast: false\n", "  check:\n", "  lint:\n    if: false\n    runs-on: ubuntu-latest\n  check:\n"),
    {
      ".github/workflows/ci.yml": ["on: push", "jobs:", "  build:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo ok", ""].join("\n"),
      ".github/workflows/pr.yaml": CI,
    },
  ];
  for (const files of shapes) assertPasses(wiredRepo(t, files));
});

test("ci fails a workflow that cannot gate the pull request, and names the fix", (t) => {
  const path = ".github/workflows/ci.yml";
  const none = 'ci: Add a workflow under .github/workflows that runs on pull_request, with a job named Check that runs "pnpm exec standard check" after actions/checkout with fetch-depth: 0.';
  const gated = (keys) => `ci: Remove ${keys} from job check in ${path}, so Check runs on every pull request and fails when the checks fail.`;
  const checkout = `ci: Add a step to job check in ${path} that uses actions/checkout with fetch-depth: 0 and no if or continue-on-error, so the commit checks see the pull request's history.`;
  const command = `ci: Add a step after actions/checkout in job check in ${path} whose run is exactly "pnpm exec standard check", with no other commands, arguments, shell, GITHUB_ variables in env, if or continue-on-error.`;
  const trigger = (fix) => `ci: In ${path}, ${fix}, so the workflow runs on every pull request to develop.`;
  const run = (text) => edit("      - run: pnpm exec standard check", `      - run: |\n${text.split("\n").map((line) => `          ${line}`).join("\n")}`);
  const cases = [
    [{ ".github/workflows/ci.yml": null, "README.md": "no workflows" }, none],
    [edit("  pull_request:\n", "  push:\n"), none],
    [edit("on:\n  pull_request:\n", "on: pull_request_target\n"), none],
    [edit("on:\n  pull_request:\n", "on: [push\n"), `ci: Make ${path} valid YAML. Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1.`],
    [edit("  pull_request:\n", "  pull_request:\n    branches: [main]\n"), trigger("make on.pull_request.branches match develop, or remove the filter")],
    [edit("  pull_request:\n", "  push:\n  pull_request:\n    branches: [develop, '!develop']\n"), trigger("make on.pull_request.branches match develop, or remove the filter")],
    [edit("  pull_request:\n", "  push:\n  pull_request:\n    branches-ignore: [develop]\n"), trigger("make on.pull_request.branches-ignore leave develop out, or remove it")],
    [edit("  pull_request:\n", "  push:\n  pull_request:\n    branches-ignore: ['dev*']\n"), trigger("make on.pull_request.branches-ignore leave develop out, or remove it")],
    [edit("  pull_request:\n", "  push:\n  pull_request:\n    branches-ignore: ['**/develop']\n"), trigger("make on.pull_request.branches-ignore leave develop out, or remove it")],
    [edit("  pull_request:\n", "  push:\n  pull_request:\n    branches: ['**', '!**/develop']\n"), trigger("make on.pull_request.branches match develop, or remove the filter")],
    [edit("  pull_request:\n", "  push:\n  pull_request: [closed]\n"), trigger("make on.pull_request a mapping of filters or leave it empty")],
    [edit("  pull_request:\n", "  pull_request:\n    branches: [develop]\n    branches-ignore: [main]\n"), trigger("keep only one of on.pull_request.branches and branches-ignore")],
    [edit("  pull_request:\n", "  push:\n  pull_request:\n    types: [closed]\n"), trigger("make on.pull_request.types include opened, synchronize and reopened, or remove it")],
    [edit("  pull_request:\n", "  push:\n  pull_request:\n    paths: ['src/**']\n"), trigger("remove on.pull_request.paths, since a pull request that skips Check cannot merge")],
    [edit("on:\n", "defaults:\n  run:\n    shell: echo {0}\non:\n"), `ci: Remove defaults.run.shell and GITHUB_ variables from the top level of ${path}, so standard check runs as written and sees the real event.`],
    [edit("    name: Check\n", "    name: Check\n    defaults:\n      run:\n        shell: echo {0}\n"), gated("defaults.run.shell")],
    [edit("    name: Check\n", "    name: Check\n    env:\n      GITHUB_EVENT_NAME: push\n"), gated("the GITHUB_ variables in env")],
    [run("set +e\npnpm exec standard check\necho done"), command],
    [run("exit 0\npnpm exec standard check"), command],
    [run("cat <<'EOF'\npnpm exec standard check\nEOF"), command],
    [edit("      - run: pnpm exec standard check", "      - run: pnpm exec standard check\n        shell: echo {0}"), command],
    [edit("      - run: pnpm exec standard check", "      - run: pnpm exec standard check\n        env:\n          GITHUB_EVENT_PATH: /dev/null"), command],
    [edit("pnpm exec standard check", "pnpm exec standard check || true"), command],
    [edit("pnpm exec standard check", "pnpm exec standard check --base=x"), command],
    [edit("    name: Check\n", ""), `ci: Add a job named Check to ${path}, with name: Check, since standard merge waits for a check run named Check.`],
    [edit("    name: Check\n", "    name: Check\n    if: github.event_name == 'push'\n"), gated("if")],
    [edit("    name: Check\n", "    name: Check\n    continue-on-error: true\n    strategy:\n      matrix:\n        node: [24, 26]\n"), gated("continue-on-error and strategy.matrix")],
    [edit("      - uses: actions/checkout@v7", "      - if: false\n        uses: actions/checkout@v7"), checkout],
    [edit("        with:\n          fetch-depth: 0\n", ""), checkout],
    [edit("        with:\n          fetch-depth: 0\n", "", "      - run: pnpm install", "      - uses: some/action@v1\n        with:\n          fetch-depth: 0"), checkout],
    [edit("        with:\n          fetch-depth: 0\n", "        continue-on-error: true\n        with:\n          fetch-depth: 0\n"), checkout],
    [edit("      - run: pnpm exec standard check", "      - if: false\n        run: pnpm exec standard check"), command],
    [edit("      - run: pnpm exec standard check", "      - run: pnpm exec standard check\n        continue-on-error: true"), command],
    [edit("pnpm exec standard check", "echo pnpm exec standard check"), command],
    [edit("      - run: pnpm exec standard check", "      - run: |\n          echo done # pnpm exec standard check"), command],
    [edit("      - run: pnpm exec standard check", "      # - run: pnpm exec standard check"), command],
    [edit("pnpm exec standard check", "pnpm exec standard check commit-subject"), command],
    [edit("      - run: pnpm exec standard check", "      - name: standard check\n        run: pnpm test"), command],
    [edit("pnpm exec standard check", "node_modules/.bin/standard check"), command],
    [edit("      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n", "", "      - run: pnpm exec standard check\n", "      - run: pnpm exec standard check\n      - uses: actions/checkout@v7\n        with:\n          fetch-depth: 0\n"), command],
    [{ ...edit("pnpm exec standard check", "pnpm test"), ".github/workflows/release.yml": "on: push\njobs:\n  check:\n    name: Check\n" }, command],
  ];
  for (const [files, line] of cases) assertFails(wiredRepo(t, files), line);
});

test("pin passes an exact version or tag and fails anything else", (t) => {
  const manifest = (spec) => ({
    "package.json": { scripts: { prepare: "standard install" }, devDependencies: { "@mapringg/standard": spec } },
  });
  for (const spec of ["0.14.7", "github:mapringg/standard#v0.14.7", "git+https://github.com/mapringg/standard.git#v0.14.7"]) {
    assertPasses(wiredRepo(t, manifest(spec)));
  }
  assertFails(
    wiredRepo(t, manifest("^0.4.0")),
    'pin: Pin @mapringg/standard to an exact version or tag such as "github:mapringg/standard#v0.14.7" in place of "^0.4.0", so every clone runs the same checks.',
  );
  assertFails(
    wiredRepo(t, manifest("github:mapringg/standard")),
    'pin: Pin @mapringg/standard to an exact version or tag such as "github:mapringg/standard#v0.14.7" in place of "github:mapringg/standard", so every clone runs the same checks.',
  );

  const { stdout, status } = wiring(wiredRepo(t, { "package.json": { scripts: { prepare: "standard install" } } }));
  assert.equal(stdout.trim(), 'wiring: pin: Add @mapringg/standard to devDependencies in package.json at "github:mapringg/standard#v0.14.7".');
  assert.equal(status, 1);
});

test("prepare passes when it starts with standard install and names what it runs otherwise", (t) => {
  const manifest = (prepare) => ({
    "package.json": {
      ...(prepare ? { scripts: { prepare } } : {}),
      devDependencies: { "@mapringg/standard": "0.14.7" },
    },
  });
  for (const prepare of ["standard install", "standard install && node scripts/link.mjs", "pnpm exec standard install"]) {
    assertPasses(wiredRepo(t, manifest(prepare)));
  }
  const fails = [
    "husky",
    "echo standard install",
    "standard install --dry-run",
    "true || standard install",
    "standard install || true",
    "standard install; exit 1",
    "node scripts/link.mjs && standard install",
    'echo "hello; standard install; goodbye"',
    "exit 0; standard install",
  ];
  for (const prepare of fails) {
    assertFails(
      wiredRepo(t, manifest(prepare)),
      `prepare: Make package.json scripts.prepare start with "standard install", which now runs "${prepare}", chaining anything else after it with &&, so every install writes the hooks.`,
    );
  }
  assertFails(
    wiredRepo(t, manifest(null)),
    'prepare: Make package.json scripts.prepare start with "standard install", chaining anything else after it with &&, so every install writes the hooks.',
  );
});

test("installed fails when package.json pins another version than the one installed", (t) => {
  const manifest = (spec) => ({
    "package.json": { scripts: { prepare: "standard install" }, devDependencies: { "@mapringg/standard": spec } },
  });
  for (const spec of ["9.9.9", "github:mapringg/standard#v9.9.9"]) {
    assertFails(
      wiredRepo(t, manifest(spec)),
      "installed: Run pnpm install, so the installed 0.14.7 becomes the @mapringg/standard 9.9.9 that package.json pins.",
    );
  }
});

test("installed fails when node_modules does not hold the package, whatever version is running", (t) => {
  const cwd = tempRepo(t);
  write(cwd, WIRED);
  git(cwd, "add", "-A");
  assertFails(cwd, "installed: Run pnpm install, so node_modules becomes the @mapringg/standard 0.14.7 that package.json pins.");
});

test("a repo without package.json fails pin and prepare", (t) => {
  const { stdout, status } = wiring(wiredRepo(t, { "package.json": null, "README.md": "no package" }));
  assert.equal(
    stdout.trim(),
    [
      'wiring: pin: Add a package.json whose devDependencies pin @mapringg/standard to "github:mapringg/standard#v0.14.7".',
      'wiring: prepare: Make package.json scripts.prepare start with "standard install", chaining anything else after it with &&, so every install writes the hooks.',
    ].join("\n"),
  );
  assert.equal(status, 1);
});

test("CLAUDE.md passes when absent or exactly @AGENTS.md and fails otherwise", (t) => {
  assertPasses(wiredRepo(t, { "CLAUDE.md": "@AGENTS.md\n" }));
  for (const text of ["@AGENTS.md", "Read AGENTS.md.\n"]) {
    assertFails(
      wiredRepo(t, { "CLAUDE.md": text }),
      'CLAUDE.md: Make CLAUDE.md exactly "@AGENTS.md" and a newline, so agents read one instructions file.',
    );
  }
});

test("wiring has no baseline: a baseline file allows nothing and the ratchet flags refuse", (t) => {
  const cwd = wiredRepo(t, {
    "CLAUDE.md": "wrong",
    ".standard/baselines/wiring.json": { wiring: ["CLAUDE.md"] },
  });
  assert.equal(wiring(cwd).status, 1);
  const { stderr, status } = standard(cwd, ["check", "wiring", "--init"]);
  assert.equal(stderr, "standard: wiring allows no findings, so it has no baseline for --init. Fix what it finds.\n");
  assert.equal(status, 1);
});
