# standard

One repository standard for every project: lint rules, repository checks, and a score that reports what each repository is missing.

## Use

Add the package at a tag and install its hooks when the repository installs:

```json
{
  "scripts": { "prepare": "standard install" },
  "devDependencies": { "@mapringg/standard": "github:mapringg/standard#v0.8.0" }
}
```

`standard install` writes three hook shims into the `.git/hooks` folder that all worktrees share and unsets `core.hooksPath`. Each shim calls `node_modules/.bin/standard`. A worktree whose checkout has `.standard/config.json` but no `node_modules` fails the hook. A worktree without `.standard/config.json` and without `node_modules` skips the hook, so installing in one worktree does not break another worktree of the same clone that is on a branch from before the repository adopted the standard. Commit `.standard/config.json`, even as `{}`, so the hooks know the repository has adopted; the `config-file` probe fails until you do.

| Command | What it does |
| --- | --- |
| `standard check [<name>...]` | Runs every check. In GitHub Actions it reads the pull request or push from `GITHUB_EVENT_PATH`, so check out with `fetch-depth: 0`. A `pull_request` event runs the commit, pull request and tree checks in one process. |
| `standard check --pr <number>` | Runs the same checks locally on a pull request that `gh pr view` reads. It fetches the pull request's base and head commits from `origin` when the clone lacks them. |
| `standard hook commit-msg <file>` | Checks the commit message. |
| `standard hook pre-commit` | Runs the `hooks.pre-commit` lines. |
| `standard hook pre-push` | Refuses a merge commit that `origin/develop` lacks, then runs the `hooks.pre-push` lines. |
| `standard merge <number> [--admin]` | Squash-merges a pull request into `develop` once its newest `Check` run is green and its title and description pass `pr-title`, `pr-body` and `pr-screenshot` with no warning. See [Merge](#merge). |
| `standard score [<path>...] [--remote] [--json]` | Reports how far each repository follows the standard. See [Score](#score). |

## Checks

`commit-subject` checks commit messages. A message is one subject line. The subject starts with a capital imperative verb, has three or more words and at most 80 characters, and has no prefix, no trailing period, no body and no trailers.

| Where the commit is | What fails |
| --- | --- |
| The `commit-msg` hook | Any broken rule. Subjects that git writes (`Merge `, `fixup! `, `squash! `, `amend! `) pass. |
| A pull request | A merge commit. A broken subject rule is a warning, because the squash replaces the commit. |
| A push to `develop` or `main` | Any broken rule, a merge commit, and a subject that does not end with its pull request number, such as `(#12)`. |

`pr-title` applies the same subject rules to the pull request title, because the title becomes the squash subject. The 80-character limit counts the ` (#<number>)` the squash adds. A title from Dependabot fails the same way, because its squash subject meets the same push check; shorten it before merging.

`pr-body` warns when the description does not follow the pull request template. It never fails the run, because the description can change until the merge. `standard merge` enforces it: it refuses a pull request whose description draws any `pr-body` warning.

| Rule | Warns when |
| --- | --- |
| Content | The description is empty or has fewer than 120 characters outside HTML comments. |
| Sections | A `## Summary`, `## Evidence` or `## Merge Danger` heading is missing. |
| Evidence | The Evidence section has no `**Before:**` and `**After:**` pair and no table with Before and After columns. |
| Door | There is no `**Door:** one-way` or `**Door:** two-way`. |
| Blast Radius | There is no `**Blast Radius:**`, or its value before the first period is more than one word. |
| Placeholder | A template placeholder such as `<one-word description>` is left in. |
| Ticket | With `pr.ticket-prefix`, a ticket line is optional, and when present it is the first line and reads `Ticket: ABC-123`. Without `pr.ticket-prefix`, any `Ticket:` line warns. |

`pr-screenshot` warns when the pull request changes a file that matches a `pr.screenshots.when` glob, which git matches as a `:(glob)` pathspec (so `**` crosses folders, `*` does not, and dotfiles count), and no `when` entry that starts with `!` excludes it, and the Evidence section has no image. The message names `pr.screenshots.uploader`. Without `pr.screenshots` the check does not apply. Like `pr-body`, it warns in CI and `standard merge` enforces it.

`pr-size` reports the pull request's size from its changed lines and never fails the run. It leaves out `pnpm-lock.yaml`, and leaves out test files unless the pull request changes only tests. A binary file and a pure rename count nothing.

| Label | Changed lines |
| --- | --- |
| `size:XS` | under 10 |
| `size:S` | 10 to 29 |
| `size:M` | 30 to 99 |
| `size:L` | 100 to 499 |
| `size:XL` | 500 to 999 |
| `size:XXL` | 1000 or more |

When `GH_TOKEN` and `GITHUB_REPOSITORY` are set, `pr-size` also creates the label if the repository lacks it, removes any other `size:` label and sets its own. The token needs both `issues: write` and `pull-requests: write`: GitHub returns 403 when a token with only `issues: write` reads a pull request's labels. A label it cannot set is a warning.

`baseline-growth` fails a pull request that adds a check to `pending`, or creates or grows a file under `.standard/baselines/`. The one exception is the pull request that removes that check from `pending`: it turns the check on and may start its baseline. It also fails when the head commit tracks a symlink under `.standard`, such as `.standard/config.json`. When the base commit has no `.standard/config.json`, it reads the base's `pending` from a root `standard.json`, so the pull request that moves the config adds nothing to `pending`.

`wiring` checks that the repository runs the standard. It keeps no baseline, so every finding fails.

| Probe | Fails when |
| --- | --- |
| `retired` | Git tracks a script that a check or command replaces, such as `scripts/check-commit-msg.mjs`. A script that several checks replace fails only once none of them is pending. The scripts `standard merge` replaces always fail, because `pending` names only checks. |
| `ci` | No workflow that runs on every `pull_request` to `develop` has a job whose check run is named `Check`, which `standard merge` waits for, with no `if`, `continue-on-error`, `strategy.matrix`, `defaults.run.shell` or `GITHUB_` variables in `env`, that uses `actions/checkout` with `fetch-depth: 0` and later has a step whose whole `run` is `standard check`, `pnpm exec standard check`, `pnpm standard check` or `npx standard check`, with no `shell`, `GITHUB_` variables, `if` or `continue-on-error`. On `pull_request`, `paths` and `paths-ignore` fail, `branches` or `branches-ignore` must let `develop` through under GitHub's glob rules, and `types` must include `opened`, `synchronize` and `reopened`. The fix names the first thing the closest workflow lacks. The probe catches wiring mistakes; whoever edits a workflow can still defeat it, and that edit shows in the pull request diff. |
| `pin` | `package.json` does not pin `@mapringg/standard` to an exact version, such as `0.5.0`, or a tag, such as `github:mapringg/standard#v0.5.0`. |
| `installed` | `node_modules/@mapringg/standard` is missing or holds a version other than the exact pin in `package.json`, so `pnpm install` has not run since the pin changed. |
| `prepare` | `scripts.prepare` does not start with `standard install` or `pnpm exec standard install`, followed by nothing or by ` && `. |
| `config-file` | Git does not track `.standard/config.json`. Commit it, even as `{}`, so the hook shims know the repository has adopted the standard. |
| `claude-md` | `CLAUDE.md` exists and is not exactly `@AGENTS.md` and a newline. |

Each finding's fix names the change, such as `Delete scripts/merge-pr.mjs, which standard merge replaces.`

`dead-code` runs knip 6.45.1 from the package's own install at the repository root, so the repository's `knip.json` applies and the repository needs no knip of its own. Each knip issue is one finding. Its key is the file, the knip issue type and the name, such as `src/a.ts exports parse`, so it stays the same when the code moves to another line. Its fix names the change, such as `Unused export parse in src/a.ts:12. Delete it, or drop the 'export' keyword if only this file uses it.` The check does not apply when git tracks no `package.json`. It replaces `scripts/check-dead-code.mjs`, its test and `scripts/baselines/dead-code.json`.

Keep a new check in `pending` until it finds nothing, then turn it on without a baseline.

## Lint and format configs

The package ships one oxlint config and one oxfmt config, tested with oxlint 1.92 and 1.93 and oxfmt 0.77 and 0.78. Each holds only the settings every adopting repository already agreed on, so a repository adds its own plugins, rules, ignores and Tailwind stylesheets on top.

| Export | File | Holds |
| --- | --- | --- |
| `@mapringg/standard/oxlint` | `config/oxlint.json` | The `eslint`, `typescript`, `unicorn`, `oxc`, `import` and `promise` plugins, `correctness` as errors, type-aware linting with type checks, unused disable directives as errors, `import/no-cycle` to depth 3, kebab-case file names and no `any`. |
| `@mapringg/standard/oxfmt` | `config/oxfmt.json` | Type imports first, then grouped value imports; sorted `package.json` scripts; `.claude/**` ignored. |

`.oxlintrc.json` takes a path in `extends`, relative to the file that extends, and refuses a package name. A child's `plugins` adds to the shared list:

```json
{
  "extends": ["../../node_modules/@mapringg/standard/config/oxlint.json"],
  "plugins": ["react", "nextjs", "jsx-a11y", "react-perf"]
}
```

`oxlint.config.ts` can import the export instead:

```ts
import { defineConfig } from "oxlint";
import standard from "@mapringg/standard/oxlint" with { type: "json" };

export default defineConfig({ extends: [standard], plugins: ["react"] });
```

oxfmt has no `extends`. Replace `.oxfmtrc.json` with `oxfmt.config.ts`, spread the export, and append to its lists rather than replace them:

```ts
import standard from "@mapringg/standard/oxfmt" with { type: "json" };

export default {
  ...standard,
  ignorePatterns: [...standard.ignorePatterns, "apps/api/migrations/**"],
  overrides: [{ files: ["apps/web/**"], options: { sortTailwindcss: { stylesheet: "./apps/web/src/app/globals.css" } } }],
};
```

## Merge

`standard merge <number>` is the one way to merge a pull request. It reads the pull request, its `ready_for_review` events, the head commit's workflow runs, its check runs, and its workflow runs again, live through `gh`, and refuses unless all of these hold:

- The pull request is open and not a draft.
- Its base is `develop`.
- The newest `Check` run on the exact head commit has concluded `success`. The gate counts only check runs named `Check` from GitHub Actions whose workflow run came from a `pull_request` event, so a `push` run on the same commit does not count. Among the `pull_request` runs of the workflow that holds `Check`, the newest is the one whose latest attempt started last (`run_started_at`, then the higher run id). A re-run moves that time forward, and a run that waits in a concurrency group has it before its `Check` run exists, so an older success cannot stand in for a newer run. If the newest run's id, attempt or status differs between the two workflow run reads, the gate refuses with `retry:`, because the check runs it read between them may belong to another attempt. When both reads show the same completed attempt, that attempt ended before the check runs were read, so its `Check` run is the one GitHub lists. A `Check` that did not conclude `success` refuses and names its conclusion. Older runs on the same commit, such as one that `cancel-in-progress` cancelled or one skipped on a `closed` event, do not block. A missing run or a run on an older commit refuses, and the message names the runs it found and the event of each.
- Every `pull_request` workflow run on the head commit has completed, in both workflow run reads. Until then the gate refuses with `wait:`. This covers a run of a workflow whose `Check` run does not exist yet and a re-run that carries a green `Check` from an earlier attempt. So a merge waits for every `pull_request` workflow on the head to finish, not only the one that holds `Check`. Runs from other events, such as `push`, do not hold it.
- That `Check` run started after the pull request last left draft, as its `ready_for_review` events show. The gate reads the start of the `Check` run itself, which a re-run of failed jobs copies from the earlier attempt, so a draft-time result cannot pass through a later attempt. The workflow run must also have been triggered after that, because a rerun replays the event it started from, including `draft: true`, so its draft-only skips would run again. A draft-time run refuses until a new event starts `Check`.

Once those hold, it reads the pull request again, right before the merge, and refuses unless all of these hold:

- The head and the title are the ones it read first. Otherwise it refuses with `retry:`, because the `Check` decision and the squash subject belong to the first read.
- The title and description pass `pr-title`, `pr-body` and `pr-screenshot` with no finding, warnings included. They are the same checks `standard check` runs in CI, with the `.standard/config.json` of the head commit, so a check in `pending` is not enforced, the squash subject is the title `pr-title` approved with ` (#<number>)` added, and a repository without `pr.screenshots` needs no screenshot. The refusal lists each finding with its fix, as `standard check` prints it. Editing the title or description fixes it; no push is needed.

`pr-screenshot` diffs the base and head commits, so `standard merge` fetches them from `origin` when the clone lacks them.

Then it runs `gh pr merge <number> --squash --match-head-commit <sha> --subject "<title> (#<number>)" --body ""`, so a push after the check cannot be merged unseen. `--admin` passes GitHub's admin flag through for required reviews and still needs a green `Check` and a description with no finding; there is no flag that skips the description. Name the CI job `Check` so the gate can find it.

A description edited after the second read and before GitHub merges is not checked. The squash body is empty, so the description never reaches the commit, and GitHub lets anyone edit a description after the merge too, so no gate can keep it fixed. What the gate guarantees is that the title and description passed the rules on the head it merges, at the second read.

Because only the newest run decides, the CI workflow can cancel a run that a newer one replaces. Add `ready_for_review` so leaving draft runs `Check` again, and `edited` so a title or description fix runs it again:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, ready_for_review]
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true
```

`github.run_id` gives each push its own group, so a push to `develop` or `main` never cancels another push's run or the deploy it carries, and `github.workflow` keeps one workflow's pull request runs from cancelling another's.

## Score

`standard score` reports how far a repository follows the standard. With no path it scores the repository it runs in. With several paths it prints one column per repository, named by its folder. It runs no check; it reads the files git tracks, `.standard/config.json` and the pin.

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
pr-screenshot in api: n/a, .standard/config.json sets no pr.screenshots

api: 16 of 16 pass
web: 16 of 17 pass
```

| Row | Passes when |
| --- | --- |
| Each `wiring` probe | The probe finds nothing. |
| `hooks` | The three shims that `standard install` writes are in the hooks folder of the repository's git common dir, and `core.hooksPath` is unset. |
| `config` | `standard check` accepts `.standard/config.json`: `pending` names only checks of this version and not `baseline-growth`. The note is the message `standard check` prints. |
| Each check | It is `on`. It is `pending` when `.standard/config.json` lists it, even where it would not apply, `debt N` when its baseline lists N findings, and `absent` when the repository does not install the package or pins a version older than the check. |
| `settings`, with `--remote` | The repository's live GitHub settings match the one state the standard expects: the default branch is `develop`; pull requests merge by squash only (`allow_squash_merge` on, `allow_merge_commit` and `allow_rebase_merge` off); the squash title is `PR_TITLE` and the squash message `BLANK`; merged branches are deleted; an active ruleset, or classic protection, on `develop` requires a pull request, and every ruleset pull request rule there allows only `squash` (the approval count is not checked); an active ruleset, or classic protection, on `main` blocks deletion and force-push. `gh api` reads the repository, then `rules/branches/develop` and `rules/branches/main` with `--paginate`, and reads a branch's classic protection only when its rulesets do not meet an expectation. Classic protection cannot limit merge methods, so on `develop` the repository's squash-only settings cover them. Each failing note names the setting, its live value, the expected value and the `gh api` command or settings page that fixes it; nothing is changed for you. When the token cannot read a branch's rules or classic protection (HTTP 403 or 404, such as a private repository on a plan without rulesets) and nothing it can read meets the expectation, the row is `unknown` with the reason and leaves the count, unless another setting fails. When the `develop` rules are unreadable, the merge methods stay `unknown` even if classic protection requires a pull request, because classic protection cannot show what an unread ruleset allows. Output that is not JSON of the expected shape fails the row, including a pull request rule without an object of parameters, a merge method other than `merge`, `squash` or `rebase`, and classic protection fields of the wrong type. `ok` means the rules exist, not that they bind every actor: the row does not check bypass actors, so an actor a ruleset lets bypass can still push or merge past it. |
| `current`, with `--remote` | The pin is not older than the latest `v<major>.<minor>.<patch>` tag of `mapringg/standard`, which `gh api` reads once per run. It is score-only, so a release never fails a repository's CI. |

`hooks`, `config`, `settings` and `current` are score-only; `standard check` already refuses an invalid `.standard/config.json`. No row checks yet that `AGENTS.md` points agents at `standard explain`, because that command does not exist yet.

A check that does not apply, such as `pr-screenshot` without `pr.screenshots`, shows `n/a` with the reason and leaves the count, as an `unknown` `settings` row does, so a repository is not marked down for a check that cannot apply to it. `pending`, `debt N` and `absent` stay in the count and fail. `--json` prints the same rows. The command exits 1 when any row fails.

## .standard/config.json

Commit the file, even as `{}`. The `config-file` probe fails without it, and the hook shims treat a checkout without it as one that has not adopted the standard. Every key is kebab-case. A key with a capital letter fails every command and the message names the kebab-case key, such as `"ticketPrefix" in .standard/config.json is camelCase; name it "ticket-prefix".` An unknown key fails every command and the message lists the known keys. A key that appears twice in one object fails every command and the message names its line and column. A root `standard.json` that git tracks also fails every command. A repository that upgrades from 0.4 moves the file and renames `ticketPrefix` in the same pull request:

```sh
mkdir -p .standard && git mv standard.json .standard/config.json
```

```json
{
  "hooks": {
    "pre-commit": ["pnpm exec lint-staged"],
    "pre-push": ["pnpm run typecheck"]
  },
  "pending": ["commit-subject"],
  "pr": {
    "ticket-prefix": "ABC",
    "screenshots": { "when": ["apps/web/**"], "uploader": "scripts/upload-evidence.mjs" }
  }
}
```

`hooks` lists shell lines that run from the repository root, in order, and stop at the first failure. `pending` lists checks the repository has not adopted yet. A pending check does not run, and the list only shrinks. `pr.ticket-prefix` is the tracker key for the `Ticket:` line; leave it out when the repository has no tickets. `pr.screenshots` turns on `pr-screenshot`: `when` lists the globs of files that need a screenshot, and `uploader` is the repository path of the script that uploads one.
