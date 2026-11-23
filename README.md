# @mapringg/standard

One shared oxlint config and plugin, plus shared oxfmt, knip and TypeScript settings.

## Use it

```json
{
  "devDependencies": {
    "@mapringg/standard": "github:mapringg/standard#v1.6.1",
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

To pass CSS variables in `style`, add ``declare module "react" { interface CSSProperties { [key: `--${string}`]: string | number } }`` to a `.d.ts` file.

Each app's and package's `package.json` maps `#/` to its own `src`:

```json
{ "imports": { "#/*": "./src/*" } }
```

Import with the source file's own extension, as `#/lib/env.ts` or `#/components/ui/button.tsx`. Node, TypeScript and the bundlers resolve `#/` against the importing file's own `package.json`, so one package can type check another's source.

A package that compiles to `dist` also maps the compiled files, and its build tsconfig sets `"noEmit": false` and `"rewriteRelativeImportExtensions": true`:

```json
{
  "imports": {
    "#/*.ts": { "types": "./src/*.ts", "compiled": "./dist/*.js", "default": "./src/*.ts" },
    "#/*": "./src/*"
  }
}
```

Run the compiled code with `node --conditions=compiled`.

`.githooks/pre-push`:

```sh
#!/bin/sh
set -e
pnpm lint
pnpm --filter "...[origin/develop]" test
```

Run `pnpm lint` from the repo root. It lints and type checks in one run, so there is no separate `tsc`. Astro apps also run `astro check`.

## Monorepo READMEs

A repository with app workspaces under `apps/` can use up to 60 prose lines in its root README and 40 in each app README. Each file has one `#` title. Use headings that fit the project. Blank lines, fenced examples, and generated blocks are excluded from the count.

Use the root README for the project's purpose, local setup, checks, and how to navigate or operate the repo. Use app READMEs for app-specific instructions and lasting operating decisions.

## AGENTS.md

An `AGENTS.md` holds only what the code, the config and lint messages can't tell an agent. `pnpm lint` checks its shape:

- One `#` title, then `##` sections chosen from Rules, Words, Copy, Decisions, Traps, Operations and Sources, in that order.
- At most 50 lines. Fenced code and a block a tool writes between `<!-- BEGIN:<name> -->` and `<!-- END:<name> -->` don't count.
- No repository paths, such as `src/lib/env.ts` or `.github/workflows/`, and no version numbers. Name the thing instead; paths and versions go stale. URL paths like `/api/auth/callback`, bare file names like `package.json`, links to other Markdown files and `owner/repo` names are fine.
- Relative links in every Markdown file resolve, including `#heading` anchors.

Adopters link the installed PR-writing, review, and test-audit skills under `## Sources` in the root `AGENTS.md`. Copy the [template's skill links](https://github.com/mapringg/monorepo/blob/main/AGENTS.md#sources). Lint reports missing links and local copies.

Review every change to an `AGENTS.md` for what lint can't check:

- Could an agent learn it from the code, the config or a lint message? Delete it.
- Will it turn false when someone renames, moves or retunes something? Keep only the lasting reason.
- Does a rule whose reason isn't obvious say why, or what breaks?
- Is it in the narrowest `AGENTS.md` that covers it, and said only once?
