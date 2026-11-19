# @mapringg/standard

One shared oxlint config and plugin, plus shared oxfmt, knip and TypeScript settings.

## Use it

```json
{
  "devDependencies": {
    "@mapringg/standard": "github:mapringg/standard#v1.1.10",
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

Next route files may import shared server i18n from `#/lib/i18n.server.ts` (or `#/lib/i18n.server`). In `src/instrumentation.ts`, Next runtime detection may read `process.env.NEXT_RUNTIME` directly. Test utilities (`*.test-utils.*`) and fixtures (`*.fixture.*`) may spread `...process.env` into an object to pass the environment to a child process.

Keep HTTP work in the API or a Server Action. Next permits `src/app/health/route.ts` exporting only `GET`, and `src/app/mcp/route.ts` for MCP. A streaming handler under `src/app/api/**/route.ts` must contain `text/event-stream`, call a `.to*StreamResponse()` helper, or have a static value import from a module named `<feature>-stream.server.ts` (the `.ts` extension may be omitted). Type-only imports do not mark a route as streaming. Forward the stream from that module; a cancellable JSON response alone does not qualify.

API tests, test utilities and fixtures may use `fetch` when the same file starts a local server with `.listen(<numeric port>)`, including `.listen(0)`. MSW's `.listen({ ... })` still requires `onUnhandledRequest: "error"` (or `onUnhandledFrame: "error"` in MSW 3). Use `testClient()` for `/api` paths; direct `app.request(...)` or `createApp().request(...)` is allowed for literal paths outside `/api`, including static template literals.
