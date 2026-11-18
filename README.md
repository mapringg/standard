# @mapringg/standard

One shared oxlint config and plugin, plus shared oxfmt, knip and TypeScript settings.

## Use it

```json
{
  "devDependencies": {
    "@mapringg/standard": "github:mapringg/standard#v1.0.1",
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

Each app's `tsconfig.json`:

```json
{
  "extends": "@mapringg/standard/tsconfig.json",
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
  "include": ["src", "*.config.ts"]
}
```

`.githooks/pre-push`:

```sh
#!/bin/sh
set -e
pnpm lint
pnpm --filter "...[origin/develop]" test
```

Run `pnpm lint` from the repo root. It lints and type checks in one run, so there is no separate `tsc`. Astro apps also run `astro check`.
