# Adopt Standard

For projects that start from a shared template, set up these commands and skill triggers in the template. Use the
[upgrade skill](.claude/skills/upgrade-standard/SKILL.md) to bring existing projects to the same release tag.

## Shared PR workflow

Open a pull request, follow the [PR skill](.claude/skills/pr/SKILL.md), and squash-merge after `Check` passes.
In GitHub's merge settings, enable only squash merging and set the default message to **Pull request title** so the
squash commit gets the PR title and an empty body.
Require an independent approval on projects with a reviewer. Make `Check` required where branch protection is available.

To check PRs in a repository that does not run Oxlint, add this step to its `Check` job after checkout with
`fetch-depth: 0`. Run the job on `pull_request` events of type `opened`, `synchronize`, `reopened`, and `edited`.

```yaml
- uses: mapringg/standard/.github/actions/check-pr@vX.Y.Z
```

Replace `vX.Y.Z` with a Standard release that includes the action. Link the PR skill from the same release in the
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

## Agent skills

Add the skill links and their triggers to the root `AGENTS.md`.

```markdown
## Sources

- Use [PR writing](node_modules/@mapringg/standard/.claude/skills/pr/SKILL.md) when starting a change or writing a PR.
- Use [Standard review](node_modules/@mapringg/standard/.claude/skills/review-standard/SKILL.md) when reviewing a branch or PR.
- Use [Test audit](node_modules/@mapringg/standard/.claude/skills/test-audit/SKILL.md) before a migration or broad refactor.
- Use [Standard upgrade](node_modules/@mapringg/standard/.claude/skills/upgrade-standard/SKILL.md) when upgrading Standard.
```

Lint requires the installed links and rejects local copies of those four skills.
If the project has a verification skill, link it in the same section with one trigger for user-visible changes.

## CI

Run `pnpm lint` from the repository root. It includes type checking. Run `pnpm format:check`, `pnpm knip` and the
repository's tests separately.

Run lint on `pull_request` events with the settings below. The `edited` event reruns the check after a title or body
edit. Full checkout history lets the check see changed files when it looks for UI evidence.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
```

Set `fetch-depth: 0` on the checkout step. Make the CI check required on the PR target branch to block merging when
a check fails.

The [PR check](src/plugin/pr-check.mjs) checks title format, template sections, and whether evidence text contains
media for certain file types. A reviewer checks whether the evidence demonstrates the change. See the
[PR skill](.claude/skills/pr/SKILL.md#evidence) for capturing and uploading evidence.
