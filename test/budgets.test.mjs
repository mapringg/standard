import assert from "node:assert/strict";
import { test } from "node:test";

import { checkEvent, git, pullRequestEvent, pullRequestRepo, standard, tempRepo, write } from "./helpers.mjs";

const lines = (count) => `# Doc\n${"text\n".repeat(count - 1)}`;

function docs(t, budgets, files) {
  const cwd = tempRepo(t, { budgets });
  write(cwd, files);
  git(cwd, "add", "-A");
  return standard(cwd, ["check", "docs"]);
}

test("budgets refuses a key that is not a kind and a value that is not a whole number of lines", (t) => {
  const kinds = "Known keys: budgets.verify, budgets.skills, budgets.agents, budgets.external, budgets.conventions, budgets.readme, budgets.template.";
  const cases = [
    [{ conventionDocs: 1 }, `"conventionDocs" in .standard/config.json is camelCase; name it "convention-docs". ${kinds}`],
    [{ plans: 1 }, `.standard/config.json has an unknown key "budgets.plans". ${kinds}`],
    [{ agents: -1 }, ".standard/config.json budgets.agents must be a whole number of lines, 0 or more."],
    [{ agents: 1.5 }, ".standard/config.json budgets.agents must be a whole number of lines, 0 or more."],
    [{ agents: "10" }, ".standard/config.json budgets.agents must be a whole number of lines, 0 or more."],
  ];
  for (const [budgets, message] of cases) {
    const { stderr, status } = docs(t, budgets, {});
    assert.equal(stderr, `standard: ${message}\n`);
    assert.equal(status, 1);
  }
});

test("docs fails a kind with docs and no budget, and a kind over its budget, and passes a kind within one", (t) => {
  const files = {
    "AGENTS.md": `${lines(3)}\n[a](docs/a.md) [b](docs/b.md) [c](docs/c.md) [d](docs/d.md)\n`,
    "docs/a.md": lines(5),
    "docs/b.md": lines(4),
    "docs/c.md": lines(3),
    "docs/d.md": lines(2),
    "README.md": lines(7),
  };
  const { stdout, status } = docs(t, { conventions: 10, readme: 7 }, files);
  assert.equal(
    stdout,
    [
      'docs: budget agents: budgets in .standard/config.json has no "agents", and agents docs total 5 lines. Add "agents": 5, then lower it as they shrink.',
      "docs: budget conventions: conventions docs total 14 lines, over budgets.conventions 10 in .standard/config.json. Cut 4 lines. Largest: docs/a.md 5, docs/b.md 4, docs/c.md 3.",
      "",
    ].join("\n"),
  );
  assert.equal(status, 1);
  assert.deepEqual(docs(t, { agents: 5, conventions: 14, readme: 7, external: 0 }, files).stdout, "docs: OK\n");
});

const pinned = (version) => ({ "package.json": { devDependencies: { "@mapringg/standard": `github:mapringg/standard#v${version}` } } });

function growth(t, { base, head, version = ["0.15.0", "0.15.0"] }) {
  const repo = pullRequestRepo(t, {
    base: { ...pinned(version[0]), ...base },
    head: { ...pinned(version[1]), ...head },
  });
  return checkEvent(t, repo.cwd, pullRequestEvent({ base: repo.base, head: repo.head }), ["baseline-growth"]);
}

const config = (value) => ({ "docs/a.md": "# A\n", ".standard/config.json": value });

test("baseline-growth fails a pull request that raises or removes a budget, and passes one that lowers a budget", (t) => {
  const raised = growth(t, { base: config({ budgets: { conventions: 10, agents: 5 } }), head: config({ budgets: { conventions: 12 } }) });
  assert.equal(
    raised.stdout,
    [
      "::error title=baseline-growth::budget agents: This PR removes budgets.agents (5) from .standard/config.json. A budget only shrinks. Keep it, or lower it.",
      "::error title=baseline-growth::budget conventions: This PR raises budgets.conventions in .standard/config.json from 10 to 12. A budget only shrinks. Cut conventions lines instead.",
      "",
    ].join("\n"),
  );
  assert.equal(raised.status, 1);
  const lowered = growth(t, { base: config({ budgets: { conventions: 10 } }), head: config({ budgets: { conventions: 8 } }) });
  assert.deepEqual([lowered.stdout, lowered.status], ["baseline-growth: OK (#123)\n", 0]);
});

test("baseline-growth lets a budget start only when docs leaves pending, arrives in a pin bump, or meets its kind's first doc", (t) => {
  const added = config({ budgets: { conventions: 50 } });
  const passing = [
    { base: config({ pending: ["docs"] }), head: added },
    { base: config({}), head: added, version: ["0.14.0", "0.15.0"] },
    { base: {}, head: added },
  ];
  for (const each of passing) {
    const { stdout, status } = growth(t, each);
    assert.deepEqual([stdout, status], ["baseline-growth: OK (#123)\n", 0]);
  }
  const { stdout, status } = growth(t, { base: config({}), head: added });
  assert.equal(
    stdout,
    "::error title=baseline-growth::budget conventions: This PR adds budgets.conventions (50) to .standard/config.json, while conventions docs existed at the base and docs ran there. A budget starts only in the pull request that removes docs from pending, in a pin bump that brings docs, or with the first doc of its kind.\n",
  );
  assert.equal(status, 1);
});
