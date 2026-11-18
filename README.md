# @mapringg/standard

One oxlint config and one oxlint plugin that hold every rule for our repositories. There is no CLI and nothing to configure per repository: each repo extends the shared files and runs oxlint, oxfmt and knip.

The package ships:

- `oxlint.json`: the shared oxlint config. Built-in rules first, with overrides per app kind (`apps/api`, `apps/web`, `apps/liff`, `apps/mobile`, `apps/marketing`, `packages`) and per owner file.
- `src/plugin/`: the `standard` oxlint JS plugin, holding only the rules no built-in rule can express.
- `oxfmt.json`, `tsconfig.json` and `knip.json`: the shared formatter, compiler and dead-code settings.

## Use it

Add the standard and its tools as dev dependencies. Use the versions this package pins in `peerDependencies`:

```json
{
  "devDependencies": {
    "@mapringg/standard": "github:mapringg/standard#v1.0.0",
    "knip": "6.45.1",
    "oxfmt": "0.79.0",
    "oxlint": "1.94.0",
    "tsrs": "0.25.0-ts7.1.0-beta"
  },
  "scripts": {
    "prepare": "git config core.hooksPath .githooks",
    "lint": "oxlint --type-aware --type-check",
    "format": "oxfmt -c node_modules/@mapringg/standard/oxfmt.json",
    "knip": "knip -c node_modules/@mapringg/standard/knip.json && knip -c node_modules/@mapringg/standard/knip.json --production"
  }
}
```

With `tsrs` installed, oxlint uses `tsrs-lint` for `--type-aware --type-check`. One run lints and type checks every tsconfig, so you don't need a separate `tsc`. Astro apps also run `astro check`.

`.oxlintrc.json` at the repo root holds only `extends`:

```json
{ "extends": ["./node_modules/@mapringg/standard/oxlint.json"] }
```

Run oxlint from the repo root. Override globs such as `apps/web/**` resolve against the root config.

Each app's `tsconfig.json` extends the base and declares the `@/` alias for its own `src/`. `paths` resolve relative to the file that declares them, so the alias can't live in the shared file:

```json
{
  "extends": "@mapringg/standard/tsconfig.json",
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
  "include": ["src", "*.config.ts"]
}
```

oxfmt and knip have no `extends`, so the scripts above pass the shared file with `-c`. knip's second run uses `--production`, so an export that only tests use is reported.

`.githooks/pre-push` runs lint and the affected tests:

```sh
#!/bin/sh
set -e
pnpm lint
pnpm --filter "...[origin/develop]" test
```

## How the plugin reports repo-wide problems

oxlint only lints JS and TS files, so `standard/repo-shape` lists the repo once per run and reports files oxlint never opens (Markdown, CSS, folders) on the first linted file of the nearest folder. It skips `.gitignore`d names and build folders.

`oxlint-disable` comments silence every rule in their file, including `standard/no-comments`. So repo-shape also reports disable directives, on a different file that has none.

## Rules

`L` = lint enforces (built-in rule or `standard/<rule>`), `R` = review only. Types the template provides are not listed.

### Toolchain and repo

- R: The standard is the only source of rules. No repo-local lint plugins or check scripts. Repo config files only extend the standard.
- R: One pnpm catalog for versions. Node and pnpm are pinned in `mise.toml`. One `hono` version everywhere.
- L `standard/repo-shape`: Monorepo of `apps/{api,web,liff,marketing,mobile}` and `packages/{tokens,i18n}`. Nothing else at top level besides config.
- L `standard/repo-shape`: Every app has `src/<routes>` and `src/lib/`, plus `src/features/<name>/` and `src/components/<group>/` (UI apps) when present.
- L `standard/repo-shape`: Feature folders hold files only, no subfolders.
- L `standard/feature-imports`: UI features import only themselves, `@/lib` and `@/components`. API features may import another feature's `db.ts` and `schema.ts` only.
- L `unicorn/filename-case`, `standard/repo-shape`, `import/no-default-export`, `oxc/no-barrel-file`: File names are kebab-case and prefixed by their feature. Named exports, except framework files. No barrels.
- L `no-restricted-imports`: Imports use the `@/` alias, never `./` or `../`.
- L `standard/repo-shape`: Tests sit next to their source in `features/`, `lib/` or `components/`, with one test file per source file. Route folders have no tests.
- L `import/no-cycle`: A query needed by two API features lives in the feature that owns the data.

### Text and docs

- L `standard/no-comments`: No comments of any kind, including disable directives and `@ts-*`. Generated `*.d.ts` and `*.gen.ts` are exempt.
- L `standard/repo-shape`: Markdown is only `README.md` and `AGENTS.md`, one each per repo and per app. `.claude/skills/**` and marketing `src/content/**` are exempt.
- L `react/jsx-no-literals`: No literal JSX text. Every user-visible string goes through `t()` from `packages/i18n`.

### Owner files

Only the owner file may use the thing it owns. Enforced with `no-restricted-globals`, `no-restricted-properties` and `no-restricted-imports`, which are switched off by glob for the owner.

- L: `lib/env.ts` reads `process.env`, `astro:env` and, through `standard/import-meta-env`, `import.meta.env`.
- L: `lib/log.ts` is the only `console` user. `lib/json.ts` owns `JSON`. `lib/format.ts` owns `Intl` and `toLocale*String`. `lib/timer.ts` owns `setTimeout`, `setInterval` and their clears.
- L: `lib/api/` owns `hono/client`. `lib/query.ts` owns `@tanstack/react-query`. `lib/ai.ts` owns `ai` and `@ai-sdk/*`. `components/ui/` owns base-ui and rn-primitives.
- L: `useSyncExternalStore` only in `lib/`.
- R: Each owner file has the same path, exports and shape in every app. The template holds the reference copy.

### React

- L `no-restricted-imports`: No `useEffect`, `useLayoutEffect` or `useInsertionEffect` outside `components/ui/**` and `apps/mobile/src/lib/notifications.ts`. No `useState`.
- L `standard/reducer`: At most one `useReducer` per component. Its reducer comes from `<feature>-state.ts` and is never a setter (`(_, value) => value`).
- L `typescript/switch-exhaustiveness-check`: Reducers handle every action.
- L `react/rules-of-hooks` and the React Compiler rules (`react/purity`, `react/immutability`, `react/refs` and the rest).
- R: Never store what can be computed from state or props.
- R: DOM observers use ref callbacks that return cleanup. Reset local UI with `key`. Open/close state lives in the UI library.

### Data

- L `standard/next-data`: `*.server.ts` imports `server-only`. Every `'use cache'` calls `cacheTag` and `cacheLife`. No exported cached function takes a user id. Cache tag literals live only in `<feature>-cache.ts`.
- L `no-restricted-imports`: Never `useQuery`, `useInfiniteQuery` or `useQueries`; read with the suspense hooks. `queryOptions` only in `<feature>-queries.ts`.
- L `no-restricted-properties`: Never `router.refresh()`.
- R: Server Components read and Server Actions write; Server Actions never read. Data loaded without a URL change uses TanStack Query, with the server streaming the first page through `HydrationBoundary`.
- R: After a write: actions call `updateTag`, webhooks call `revalidateTag(tag, "max")`, uncached data uses `refresh()`.

### Next.js

- L `standard/next-routes`: `page.tsx` and `layout.tsx` are synchronous, with no top-level await. Pages take `PageProps`.
- L `no-restricted-imports`: Pages and layouts never import `next/headers`, `@/lib/api` or `*.server` files.
- L `standard/repo-shape`: No `loading.tsx`, no parallel or intercepting routes, no `_private` folders. `app/` holds only Next route files. `route.ts` only under `webhooks/` or for metadata. Each route group has an `error.tsx`.
- L `no-restricted-imports`: Raw `Suspense` only in `components/boundary/section.tsx`.
- L `standard/server-actions`: Server Actions live only in `<feature>-actions.ts`, file-level `'use server'`, export names ending in `Action`. No inline actions.
- R: Actions parse, call the API, update the cache and return `{ ok: true, data } | { ok: false, message, fieldErrors? }`.
- R: `proxy.ts` does optimistic redirects, rewrites and headers, never security. The API is the only security check.
- R: Forms use `<form action>`, uncontrolled inputs and `useActionState`. `typedRoutes` is on. One stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
- R: The browser reaches the API through one `/api/:path*` rewrite. Server code calls the internal API URL with the forwarded session cookie.

### URL params

- L `no-restricted-globals`, `no-restricted-properties`, `no-restricted-imports`: Only `<feature>-params.ts` reads search params (`URLSearchParams`, `.searchParams`, `useLocalSearchParams`, `useSearch`). Web pages may pass `searchParams` to it. Web never uses `useSearchParams`.
- L `standard/params`: Params use the standard names (`q`, `sort`, `cursor`, `from`/`to`, `<field>From`/`<field>To`, field filters). LIFF `validateSearch` is the feature params schema.
- R: Defaults stay out of the URL. Cursors are short. Infinite scroll never puts the cursor in the URL.

### API (Hono)

- L `no-restricted-imports`: `Hono` and `createFactory` only in `src/factory.ts`. Validators only in `src/lib/validate.ts`. Drivers only in a feature `db.ts` or `src/infra/`.
- L `no-restricted-globals`: `fetch` only in `src/upstreams/`.
- L `standard/repo-shape`: Layout `src/{app.ts, factory.ts, env.ts, middleware/, lib/, infra/, upstreams/, features/<resource>/{routes,schema,db,service}.ts}`.
- L `standard/hono`: Routers are one chain. `c.json` always takes a status. Input is read only with `c.req.valid()`. Route paths are `/`, `/:id` and `POST /:id/<verb>`, mounted at `/api/<plural-kebab>`. Every route has `describeRoute`. Handlers are inline and at most 10 lines. OpenAPI and docs are mounted only in development.
- L `no-restricted-properties`: No `.put` routes. Tests call routes through `testClient`, not `app.request`.
- R: Only additive changes. API tests check responses against the documented schemas. Errors map in one file. `Idempotency-Key` on POSTs that must not run twice. Every log line and error carries `requestId`.
- R: One session store, a cookie for web and a bearer token for mobile and LIFF. Routers are authenticated by default. Others' resources return 404. `csrf()` and JSON-only writes.

### LIFF, mobile, marketing, styling

- R: LIFF `main.tsx` awaits `liff.init`, exchanges the session, then renders the router. Only the ID token goes to `POST /api/sessions`. The session token stays in memory. `@line/liff` >= 2.31.1.
- L `no-restricted-imports`, `no-restricted-properties`: Mobile never uses `useFocusEffect`, `Keyboard.addListener`, React Native's `SafeAreaView` or `StyleSheet.create`.
- R: Mobile inputs are uncontrolled through `lib/form.ts`. Lists use FlashList with `useSuspenseInfiniteQuery`. Tests use jest-expo and RN Testing Library.
- L `standard/repo-shape`: `.astro` files only in marketing `src/pages/` and `src/components/layout/`.
- L `react/forbid-dom-props`, `react/forbid-component-props`, `standard/repo-shape`: No inline `style`. No CSS files besides one global per app, no CSS modules, no preprocessors.

### Testing

- L `standard/tests`: No real clock without fake timers. No polling loops, no per-test timeouts, no tests inside loops. No render-only component tests, no tests whose only assertions are call checks. No `vi.mock`/`jest.mock` of in-repo modules. No coverage thresholds.
- L `vitest/no-focused-tests`, `vitest/no-disabled-tests`, `vitest/no-restricted-matchers`, `vitest/no-restricted-vi-methods`, `no-restricted-properties`, `no-restricted-imports`: No `.only` or `.skip`, no snapshots, no `vi.waitFor`/`vi.waitUntil`/`expect.poll`/`waitFor`, no `vi.setConfig` or `jest.setTimeout`. Timers stay owned by `lib/timer.ts`, so tests can't sleep.
- L knip `--production`: Exports used only by tests fail.
- R: Agent verification of the real app, with screenshots or a recording and the commands run in the PR body, is the required proof for every user-visible PR.
- R: Keep only API route tests through `testClient` against a real local database, one test per auth guard, table-driven tests for outside formats and branching logic, and 5 to 10 end-to-end journeys per app.
- R: A logic bug fix adds one test that fails before the fix, in an existing file. A visual fix adds before/after screenshots and no test.
- R: A new test names the contract it protects, the bug that breaks it and why no existing test catches it. Each behavior is tested in one place.
- R: CI comments when a PR adds more than 15 tests net or any new browser test file.
- R: PRs and pre-push run only affected tests. Lockfile, config or `packages/*` changes run everything. The full suite runs after each merge to develop.

### Git

- R: One PR is one squash commit on develop. Squash-merge only. Never merge to main.
