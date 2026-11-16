# standard

One repository standard for every project: lint rules, repository checks, and a score that reports what each repository is missing.

## Use

Add the package at a tag and install its hooks when the repository installs:

```json
{
  "scripts": { "prepare": "standard install" },
  "devDependencies": { "@mapringg/standard": "github:mapringg/standard#v0.1.0" }
}
```

`standard install` writes three hook shims into the `.git/hooks` folder that all worktrees share and unsets `core.hooksPath`. Each shim calls `node_modules/.bin/standard`, so a worktree without `node_modules` fails the hook.

| Command | What it does |
| --- | --- |
| `standard check [<name>...]` | Runs every check. In GitHub Actions it reads the pull request or push from `GITHUB_EVENT_PATH`, so check out with `fetch-depth: 0`. A `pull_request` event runs the commit, pull request and tree checks in one process. |
| `standard check --pr <number>` | Runs the same checks locally on a pull request that `gh pr view` reads. The clone needs the pull request's base and head commits. |
| `standard hook commit-msg <file>` | Checks the commit message. |
| `standard hook pre-commit` | Runs the `hooks.pre-commit` lines. |
| `standard hook pre-push` | Refuses a merge commit that `origin/develop` lacks, then runs the `hooks.pre-push` lines. |
| `standard merge <number> [--admin]` | Squash-merges a pull request into `develop` once its `Check` run is green. See [Merge](#merge). |

## Checks

`commit-subject` checks commit messages. A message is one subject line. The subject starts with a capital imperative verb, has three or more words and at most 80 characters, and has no prefix, no trailing period, no body and no trailers.

| Where the commit is | What fails |
| --- | --- |
| The `commit-msg` hook | Any broken rule. Subjects that git writes (`Merge `, `fixup! `, `squash! `, `amend! `) pass. |
| A pull request | A merge commit. A broken subject rule is a warning, because the squash replaces the commit. |
| A push to `develop` or `main` | Any broken rule, a merge commit, and a subject that does not end with its pull request number, such as `(#12)`. |

`pr-title` applies the same subject rules to the pull request title, because the title becomes the squash subject. The 80-character limit counts the ` (#<number>)` the squash adds. A title from Dependabot only warns.

`pr-body` warns when the description does not follow the pull request template. It never fails the run, because the description can change until the merge.

| Rule | Warns when |
| --- | --- |
| Content | The description is empty or has fewer than 120 characters outside HTML comments. |
| Sections | A `## Summary`, `## Evidence` or `## Merge Danger` heading is missing. |
| Evidence | The Evidence section has no `**Before:**` and `**After:**` pair and no table with Before and After columns. |
| Door | There is no `**Door:** one-way` or `**Door:** two-way`. |
| Blast Radius | There is no `**Blast Radius:**`, or its value before the first period is more than one word. |
| Placeholder | A template placeholder such as `<one-word description>` is left in. |
| Ticket | With `pr.ticketPrefix`, a ticket line is optional, and when present it is the first line and reads `Ticket: ABC-123`. Without `pr.ticketPrefix`, any `Ticket:` line warns. |

`pr-screenshot` warns when the pull request changes a file that matches a `pr.screenshots.when` glob and the Evidence section has no image. The message names `pr.screenshots.uploader`. Without `pr.screenshots` the check does not apply.

`pr-size` reports the pull request's size from its changed lines and never fails the run. It leaves out `pnpm-lock.yaml`, and leaves out test files unless the pull request changes only tests. A binary file and a pure rename count nothing.

| Label | Changed lines |
| --- | --- |
| `size:XS` | under 10 |
| `size:S` | 10 to 29 |
| `size:M` | 30 to 99 |
| `size:L` | 100 to 499 |
| `size:XL` | 500 to 999 |
| `size:XXL` | 1000 or more |

When `GH_TOKEN` and `GITHUB_REPOSITORY` are set, `pr-size` also creates the label if the repository lacks it, removes any other `size:` label and sets its own. The token needs `issues: write`. A label it cannot set is a warning.

`baseline-growth` fails a pull request that adds a check to `pending`, or creates or grows a file under `.standard/baselines/`. The one exception is the pull request that removes that check from `pending`: it turns the check on and may start its baseline.

## Merge

`standard merge <number>` is the one way to merge a pull request. It reads the pull request and its head commit's check runs live through `gh`, and refuses unless all of these hold:

- The pull request is open and not a draft.
- Its base is `develop`.
- Its title passes the `pr-title` rules with ` (#<number>)` added.
- A check run named `Check` from GitHub Actions on the exact head commit has concluded `success`. A missing run, a run on an older commit, or a run in any other state refuses, and the message names the runs it found.

Then it runs `gh pr merge <number> --squash --match-head-commit <sha> --subject "<title> (#<number>)" --body ""`, so a push after the check cannot be merged unseen. `--admin` passes GitHub's admin flag through for required reviews and still needs a green `Check`. Name the CI job `Check` so the gate can find it.

## standard.json

The file is optional. An unknown key fails every command.

```json
{
  "hooks": {
    "pre-commit": ["pnpm exec lint-staged"],
    "pre-push": ["pnpm run typecheck"]
  },
  "pending": ["commit-subject"],
  "pr": {
    "ticketPrefix": "ABC",
    "screenshots": { "when": ["apps/web/**"], "uploader": "scripts/upload-evidence.mjs" }
  }
}
```

`hooks` lists shell lines that run from the repository root, in order, and stop at the first failure. `pending` lists checks the repository has not adopted yet. A pending check does not run, and the list only shrinks. `pr.ticketPrefix` is the tracker key for the `Ticket:` line; leave it out when the repository has no tickets. `pr.screenshots` turns on `pr-screenshot`: `when` lists the globs of files that need a screenshot, and `uploader` is the repository path of the script that uploads one.
