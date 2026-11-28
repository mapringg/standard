---
name: adopt-standard
description: Create, adopt, or configure a repository that uses Standard.
---

# Adopt Standard

For projects that start from a shared template, set up these commands and skill triggers in the template. Use the
[upgrade skill](../upgrade-standard/SKILL.md) to bring existing projects to the same release tag.

## Create or adopt a repo

Run the command outside a Git checkout to create a repository, or inside a checkout to adopt it. Use Node 26 and
a signed-in GitHub CLI account with admin access. Select **app** for the monorepo template and local app checks, or
**plain** for the shared PR check alone.

```sh
pnpm dlx --package=github:mapringg/standard#v1.15.2 create-mapringg-repo
```

New repos default to private and start with `Initial commit`. The command runs applicable local checks, pushes the
baseline, and waits for the GitHub check. Template production deploys start in manual mode. Existing repos retain
their history and checks. The command opens or reuses a setup PR when files need changes and reports its CI result.
Rerun the command after an interruption. Use `--help` for non-interactive options.

## Shared PR workflow

Open one pull request per change from the latest target branch. Start the title with a capitalised verb and fit it
within 80 characters including the squash suffix ` (#<number>)`. Write the body with the [PR skill](../pr/SKILL.md),
gather proof with [Capture](../capture/SKILL.md), and squash-merge after `Check` passes.
In GitHub's merge settings, enable only squash merging and set the default message to **Pull request title** so the
squash commit gets the PR title and an empty body.
Require an independent approval on projects with a reviewer. Make `Check` required where branch protection is available.

To check PRs in a repository that does not run Oxlint, add this step to its `Check` job.
Run the job on `pull_request` events of type `opened`, `synchronize`, `reopened`, and `edited`.

```yaml
- uses: mapringg/standard/.github/actions/check-pr@vX.Y.Z
```

Replace `vX.Y.Z` with a Standard release that includes the action. Link both skills from the same release in the
repository's `AGENTS.md`. Run the project's own checks in the same job.

## Install

```json
{
  "devDependencies": {
    "@mapringg/standard": "github:mapringg/standard#<tag>",
    "knip": "<version>",
    "oxfmt": "<version>",
    "oxlint": "<version>",
    "tsrs": "<version>"
  },
  "scripts": {
    "prepare": "git config core.hooksPath .githooks",
    "lint": "oxlint",
    "format": "oxfmt -c node_modules/@mapringg/standard/oxfmt.json",
    "format:check": "oxfmt -c node_modules/@mapringg/standard/oxfmt.json --check",
    "knip": "knip -c node_modules/@mapringg/standard/knip.json && knip -c node_modules/@mapringg/standard/knip.json --production"
  }
}
```

Use the latest release tag. Pin `knip`, `oxfmt`, `oxlint` and `tsrs` to the exact versions in that tag's `peerDependencies`.

## Wiring

Extend Standard in the root `.oxlintrc.json`.

```json
{ "extends": ["./node_modules/@mapringg/standard/oxlint.json"] }
```

Extend the shared `tsconfig.json` in each app and package.

```json
{
  "extends": "@mapringg/standard/tsconfig.json",
  "include": ["src", "*.config.ts"]
}
```

A React app types CSS variables in a `.d.ts` file with ``declare module "react" { interface CSSProperties { [key: `--${string}`]: string | number } }``.

Each app's and package's `package.json` maps `#/` to its own `src`. Import with the file's extension, as `#/lib/env.ts`.

```json
{ "imports": { "#/*": "./src/*" } }
```

A package that compiles to `dist` also maps the compiled files, and its build tsconfig sets `"noEmit": false` and `"rewriteRelativeImportExtensions": true`. Run it with `node --conditions=compiled`.

```json
{
  "imports": {
    "#/*.ts": { "types": "./src/*.ts", "compiled": "./dist/*.js", "default": "./src/*.ts" },
    "#/*": "./src/*"
  }
}
```

Use the same root commands in `.githooks/pre-push`. This example compares affected packages with `develop` when it
exists and `main` otherwise.

```sh
#!/bin/sh
set -e
base=origin/develop
git rev-parse --verify --quiet "$base" >/dev/null || base=origin/main
pnpm format:check
pnpm lint
pnpm knip
pnpm --filter "...[$base]" --if-present test
```

## Design system

Standard runs [@shadcn/lint](https://github.com/shadcn-ui/lint) on every UI app. Import components from
`#/components/ui`, keep the theme in the app's one global CSS file, and use only its tokens.
Keep the rules as shipped: no `settings.shadcn`, rule options, or overrides for `shadcn/*` rules.

Fix a `shadcn/no-restyle` finding in this order:

1. Use the component's existing variant or size that gives the look.
2. Move spacing around the component to margin on it or `gap` on its parent.
3. Add a variant or size in the component file and use it.

Fix other findings with the replacement the message names, or the nearest theme token. Add a token to the
theme only when the design needs a value the scale lacks.

## Repository documentation

Use one root README with the project title, a one-sentence overview, and a Quick start section.
Each prose paragraph and bullet may have up to 100 visible characters.

Use scoped AGENTS.md files starting with the title AGENTS.md.
Write flat, single-line bullets under Rules and optional Sources.
Put a verification command under Rules with its trigger.
In a repo with Vitest, add this bullet under the root Rules. Lint requires it.

```markdown
- Run `pnpm --filter <app> exec vitest run --since-last-run` after each change and `pnpm test` at the end.
```

Link to a skill under Sources when an agent needs a longer procedure.
Keep shared skill links at the root. Local Sources apply only to their directory.

Use no handwritten explanatory comments. Name things clearly and put lasting constraints in scoped Rules.
Keep machine-read directives and generated markers. Extend comment checks by format.

Run `pnpm exec check-pr --docs` from the repo root to check the layout before updating CI.
The shared PR action and the Standard PR lint rule use the same checks.

## Agent skills

Keep skill links and their triggers under `## Sources` in the root `AGENTS.md` so they are available in a fresh checkout.

```markdown
## Sources

- Use [PR writing](node_modules/@mapringg/standard/.claude/skills/pr/SKILL.md) when writing a pull request.
- Follow [Capture](node_modules/@mapringg/standard/.claude/skills/capture/SKILL.md) when preparing pull request evidence.
```

Lint requires the installed links and rejects local copies of the two skills. For repositories without the package installed,
link to both skills at the same pinned Standard release.
If the project has a verification skill, link it in the same section with one trigger for user-visible changes.
Pin Agent Browser in projects that capture web evidence. Install its browser, and install FFmpeg for recordings.

## CI

Run `pnpm lint` from the repository root. It includes type checking. Run `pnpm format:check`, `pnpm knip` and the
repository's tests separately.

Run lint on `pull_request` events with the settings below. The `edited` event reruns the check after a title or body
edit.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
```

Make the CI check required on the PR target branch to block merging when a check fails.

The [PR check](../../../src/plugin/pr-check.mjs) checks the title, template sections, and populated Before and After evidence.
A reviewer checks whether the evidence demonstrates the change.
