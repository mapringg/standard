# standard

One repository standard for every project: lint rules, repository checks, and a score that reports what each repository is missing.

## Use

Add the package at a tag and install its hooks when the repository installs:

```json
{
  "scripts": { "prepare": "standard install" },
  "devDependencies": { "@mapringg/standard": "github:mapringg/standard#v0.4.0" }
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
| `standard score [<path>...] [--remote] [--json]` | Reports how far each repository follows the standard. See [Score](#score). |

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

`wiring` checks that the repository runs the standard. It keeps no baseline, so every finding fails.

| Probe | Fails when |
| --- | --- |
| `retired` | Git tracks a script that a check or command replaces, such as `scripts/check-commit-msg.mjs`. A script that several checks replace fails only once none of them is pending. The scripts `standard merge` replaces always fail, because `pending` names only checks. |
| `ci` | No workflow that runs on every `pull_request` to `develop` has a job whose check run is named `Check`, which `standard merge` waits for, with no `if`, `continue-on-error`, `strategy.matrix`, `defaults.run.shell` or `GITHUB_` variables in `env`, that uses `actions/checkout` with `fetch-depth: 0` and later has a step whose whole `run` is `standard check`, `pnpm exec standard check`, `pnpm standard check` or `npx standard check`, with no `shell`, `GITHUB_` variables, `if` or `continue-on-error`. On `pull_request`, `paths` and `paths-ignore` fail, `branches` or `branches-ignore` must let `develop` through under GitHub's glob rules, and `types` must include `opened`, `synchronize` and `reopened`. The fix names the first thing the closest workflow lacks. The probe catches wiring mistakes; whoever edits a workflow can still defeat it, and that edit shows in the pull request diff. |
| `pin` | `package.json` does not pin `@mapringg/standard` to an exact version, such as `0.4.0`, or a tag, such as `github:mapringg/standard#v0.4.0`. |
| `installed` | `node_modules/@mapringg/standard` is missing or holds a version other than the exact pin in `package.json`, so `pnpm install` has not run since the pin changed. |
| `prepare` | `scripts.prepare` does not start with `standard install` or `pnpm exec standard install`, followed by nothing or by ` && `. |
| `claude-md` | `CLAUDE.md` exists and is not exactly `@AGENTS.md` and a newline. |

Each finding's fix names the change, such as `Delete scripts/merge-pr.mjs, which standard merge replaces.`

## Merge

`standard merge <number>` is the one way to merge a pull request. It reads the pull request and its head commit's check runs live through `gh`, and refuses unless all of these hold:

- The pull request is open and not a draft.
- Its base is `develop`.
- Its title passes the `pr-title` rules with ` (#<number>)` added.
- A check run named `Check` from GitHub Actions on the exact head commit has concluded `success`. A missing run, a run on an older commit, or a run in any other state refuses, and the message names the runs it found.

Then it runs `gh pr merge <number> --squash --match-head-commit <sha> --subject "<title> (#<number>)" --body ""`, so a push after the check cannot be merged unseen. `--admin` passes GitHub's admin flag through for required reviews and still needs a green `Check`. Name the CI job `Check` so the gate can find it.

## Score

`standard score` reports how far a repository follows the standard. With no path it scores the repository it runs in. With several paths it prints one column per repository, named by its folder. It runs no check; it reads the files git tracks, `standard.json` and the pin.

```text
$ standard score ../api ../web
                   api     web
wiring
  retired          ok      fail
  ci               ok      ok
  ...
  hooks            ok      ok
  config           ok      ok
checks
  commit-subject   on      on
  pr-screenshot    n/a     on
  ...

retired in web: Delete scripts/merge-pr.mjs, which standard merge replaces.
pr-screenshot in api: n/a, standard.json sets no pr.screenshots

api: 14 of 14 pass
web: 14 of 15 pass
```

| Row | Passes when |
| --- | --- |
| Each `wiring` probe | The probe finds nothing. |
| `hooks` | The three shims that `standard install` writes are in the hooks folder of the repository's git common dir, and `core.hooksPath` is unset. |
| `config` | `standard check` accepts `standard.json`: `pending` names only checks of this version and not `baseline-growth`. The note is the message `standard check` prints. |
| Each check | It is `on`. It is `pending` when `standard.json` lists it, even where it would not apply, `debt N` when its baseline lists N findings, and `absent` when the repository does not install the package or pins a version older than the check. |
| Each GitHub setting, with `--remote` | The default branch is `develop`; pull requests merge by squash only; the squash title is the pull request title; the squash message is blank; merged branches are deleted. `gh api` reads each repository's settings once. |
| `current`, with `--remote` | The pin is not older than the latest `v<major>.<minor>.<patch>` tag of `mapringg/standard`, which `gh api` reads once per run. It is score-only, so a release never fails a repository's CI. |

`hooks`, `config` and `current` are score-only; `standard check` already refuses an invalid `standard.json`. No row checks yet that `AGENTS.md` points agents at `standard explain`, because that command does not exist yet.

A check that does not apply, such as `pr-screenshot` without `pr.screenshots`, shows `n/a` with the reason and leaves the count, so a repository is not marked down for a check that cannot apply to it. `pending`, `debt N` and `absent` stay in the count and fail. `--json` prints the same rows. The command exits 1 when any row fails.

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
