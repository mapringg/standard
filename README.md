# @mapringg/standard

One shared oxlint config and plugin, plus shared oxfmt, knip and TypeScript settings.

## Install

```json
{
  "devDependencies": {
    "@mapringg/standard": "github:mapringg/standard#v1.6.2",
    "knip": "6.45.1",
    "oxfmt": "0.79.0",
    "oxlint": "1.94.0",
    "tsrs": "0.25.0-ts7.1.0-beta"
  },
  "scripts": {
    "prepare": "git config core.hooksPath .githooks",
    "lint": "oxlint",
    "format": "oxfmt -c node_modules/@mapringg/standard/oxfmt.json",
    "knip": "knip -c node_modules/@mapringg/standard/knip.json && knip -c node_modules/@mapringg/standard/knip.json --production"
  }
}
```

## Wiring

`.oxlintrc.json` at the repo root:

```json
{ "extends": ["./node_modules/@mapringg/standard/oxlint.json"] }
```

Each app's and package's `tsconfig.json`:

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

`.githooks/pre-push`:

```sh
#!/bin/sh
set -e
pnpm lint
pnpm --filter "...[origin/develop]" test
```

Link the installed skills under `## Sources` in the root `AGENTS.md`, as in the [template](https://github.com/mapringg/monorepo/blob/main/AGENTS.md#sources).

## Commands

- `pnpm lint`: lints and type checks in one run, so there is no separate `tsc`.
- In a `pull_request` CI run, `pnpm lint` also checks the PR body against the [PR skill](.claude/skills/pr/SKILL.md).

## Configs

- `oxlint.json`: rules, with the plugin at `@mapringg/standard/plugin`.
- `oxfmt.json`: formatting.
- `tsconfig.json`: TypeScript settings.
- `knip.json`: unused files, exports and dependencies.
- Skills: [pr](.claude/skills/pr/SKILL.md), [review-standard](.claude/skills/review-standard/SKILL.md), [test-audit](.claude/skills/test-audit/SKILL.md).
