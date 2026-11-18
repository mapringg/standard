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
    "lint": "oxlint",
    "format": "oxfmt -c node_modules/@mapringg/standard/oxfmt.json",
    "knip": "knip -c node_modules/@mapringg/standard/knip.json && knip -c node_modules/@mapringg/standard/knip.json --production"
  }
}
```

The shared config sets `options.typeAware` and `options.typeCheck`, so plain `oxlint` is the one way to run it. With `tsrs` installed, oxlint uses `tsrs-lint` for both: one run lints and type checks every tsconfig, so you don't need a separate `tsc`. Astro apps also run `astro check`.

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

Public API routes are listed only in `apps/api/src/middleware/public-routes.ts`, as `export const publicRoutes = [...]`. No other file may export a public-route list. To make the whole API public, list `"/api/*"`:

```ts
export const publicRoutes = ["/api/*"];
```

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

The agreed rule list. `(L)` = lint enforces, `(T)` = types enforce, `(R)` = review only.

### Toolchain

- oxlint with the shared config and our plugin, type-aware with tsrs (`oxlint --type-aware --type-check`); oxfmt; knip; one pre-push hook. No custom CLI, no per-repo config. Astro also runs `astro check`.
- The standard is the only source of rules. No repo-local lint plugins, no custom check scripts. Repo config files only `extends` the standard. (R)
- One pnpm catalog for versions, Node and pnpm pinned in `mise.toml`. One `hono` version everywhere. (R)

### Repo shape

- Monorepo: `apps/{api,web,liff,marketing,mobile}`, `packages/{tokens,i18n}`. Nothing else at top level besides config. (L)
- Every app: `src/<routes>`, `src/features/<name>/`, `src/components/<group>/` (UI apps), `src/lib/`. Routes folder: Next/Expo/LIFF `app/`, Astro `pages/`, Hono `app.ts`. (L)
- Feature folders hold files only, no subfolders. Too big: split into two features. (L)
- UI apps: a feature imports only itself, `lib`, `components`. Features meet only in routes. (L)
- API: a feature may import another feature's `db.ts` and `schema.ts` only. (L)
- Route files only compose; no literal text, no tests, no data imports (L); no logic (R).
- File names kebab-case, prefixed by feature (`task-actions.ts`). Named exports, except framework files. No barrel files. (L)
- Imports always use the `@/` alias, never `./` or `../`. (L)
- Tests sit next to the code they test in `features/`, `lib/` or `components/`, as `*.test.ts(x)`. Route files never have tests. (L)
- A query needed by two API features lives in the feature that owns the data; `import/no-cycle` on. (L)

### Text and docs

- No comments of any kind, including `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`. Generated `*.d.ts` exempt. (L)
- Markdown only `README.md` and `AGENTS.md` (one each per repo and per app). Exempt: `.claude/skills/**`, marketing `src/content/**`. No CLAUDE.md. (L)
- Every user-visible string goes through `t()` from `packages/i18n`; dictionaries in `lib/i18n/messages/<feature>.ts`. No literal JSX text or literal `placeholder`, `aria-label`, `title`, `alt`. (L)

### Owner files (only these may use the thing)

- Each owner file has the same path, exports and shape in every app; the template holds the reference copy. Only project values differ (env names, model names). (L for path, R for shape)
- `lib/env.ts`: env vars, parsed with zod. (L)
- `lib/log.ts`: the only `console` user; one JSON line per log (`level`, `message`, `time`, fields incl. `requestId`); same file in every app. (L)
- `lib/json.ts`: `JSON.parse/stringify`. (L)
- `lib/format.ts`: `Intl`, dates, numbers; user time zone for display, UTC on the wire. (L)
- `lib/timer.ts`: `setTimeout`, `setInterval`. (L)
- `lib/api/`: the typed Hono client `hc<AppType>`. (L)
- `lib/query.ts`: TanStack Query client and defaults; the only importer of `@tanstack/react-query`. (L)
- `lib/ai.ts`: the only importer of `ai` and `@ai-sdk/*` (models, keys from env, timeouts, usage logging); web uses it only for the chat hook. (L)
- `components/ui/`: the UI primitive library (base-ui on web/LIFF, rn-primitives on mobile), and any library that needs an effect. (L)
- `useSyncExternalStore` only in `lib/`. (L)

### Types

- No chained type assertions (`as unknown as T`); `as const` allowed. (L)
- No runtime `typeof` narrowing; parse at the boundary with zod. `typeof x === "undefined"` allowed. (L)

### React (all UI apps)

- No `useEffect`, `useLayoutEffect`, `useInsertionEffect`. Only exception: `components/ui/**` library wrappers and `apps/mobile/src/lib/notifications.ts`. (L)
- No `useState`. At most one `useReducer` per component. (L)
- Reducer state is a union of named shapes, actions are a union, the reducer handles every action (exhaustive switch). Reducer, types and initial value live in `<feature>-state.ts`. (L/T)
- Never store what can be computed from state or props. (R)
- State from React beyond `useReducer`: only `useActionState`, `useOptimistic`, `useTransition`, `useFormStatus`. (R)
- DOM observers via ref callbacks returning cleanup. Reset local UI with `key`. (R)
- Open/close state lives in the UI library (uncontrolled). (R)

### Data

- web: reads in Server Components; writes only in Server Actions; Server Actions never read. No `fetch` outside `lib/api` and `upstreams/`. (L for fetch, R for the rest)
- Data loaded without a URL change (infinite scroll, live, polling) uses TanStack Query; the server starts the first page and streams it via `HydrationBoundary`. (L/R)
- liff and mobile: reads `useSuspenseQuery` / `useSuspenseInfiniteQuery`, writes `useMutation` then `invalidateQueries`; fetchers call the typed API client. Never `useQuery`. (L)
- Server data files `*.server.ts` import `server-only`; browser code can't import them. (L)
- Every `'use cache'` calls `cacheTag` and `cacheLife`; per-user data uses `'use cache: private'`; never export a cached function that takes a user id. (L)
- After a write: action `updateTag`; webhook `revalidateTag(tag, "max")`; uncached data `refresh()` (R). Never `router.refresh()` (L).
- Query keys and `queryOptions` live in `<feature>-queries.ts`; cache tags in `<feature>-cache.ts`. (L)

### Next.js (web)

- `page.tsx` is synchronous, typed `PageProps`, composes inside `<Suspense>`. No top-level await. (L)
- `layout.tsx` is chrome only; never reads session or data. (L)
- No `loading.tsx`. Loading sections use `<Section fallback>` from `components/boundary/section.tsx` (Suspense + error boundary + retry); raw `Suspense` is imported only there. `error.tsx` per route group with `retry`. (L)
- `route.ts` only for webhooks and metadata. (L)
- No parallel or intercepting routes. Route groups allowed. No `_private` folders in `app/`. (L)
- `proxy.ts`: optimistic sign-in redirect, rewrites, headers. Never security. (R)
- Auth: the API is the only security check. The server API client in `lib/api` turns 401 into a redirect to `/signin`. Current user via `GET /api/sessions/current`. Never check auth in layouts or pages. (L)
- Server Actions only in `<feature>-actions.ts`, export names end in `Action`, never inline in components (L). Order: parse, call API, update cache, return; result `{ ok: true, data } | { ok: false, message, fieldErrors? }` (R/T).
- Forms: `<form action>`, uncontrolled inputs, `useActionState`. (R)
- `typedRoutes` on. One stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. (R)
- Browser reaches the API through one `/api/:path*` rewrite. Only `lib/api/client.server.ts` creates the server client (internal URL, forwards only the session cookie). (L via owner rule)

### URL params (all UI apps)

- One `<feature>-params.ts` per feature: zod/mini schema with `parse()` (bad values fall back to defaults) and `href()`. Only that file reads search params. (L)
- Fixed names: `q` search, `sort=-field,other`, `cursor`, `from`/`to` (ISO date, half-open), `<field>From`/`<field>To`, filters by field name, arrays as repeated keys, booleans `true`/`false`. Defaults left out of the URL. Presets (`last-7-days`) may live in the URL; the API gets `from`/`to`. (L)
- web: parse on the server, pass as props; no `useSearchParams`. (L)
- Cursors are short (about 10 characters, encoding the last item id). Infinite scroll never puts the cursor in the URL. (R)

### API (Hono)

- One `src/factory.ts` (`createFactory<AppEnv>`); every router `factory.createApp()` as one chain; inline handlers; `async/await` (R); explicit status on every `c.json`. `new Hono` nowhere else. (L)
- Layout: `src/{app.ts, factory.ts, env.ts, middleware/, lib/, infra/, upstreams/<vendor>.ts, features/<resource>/{routes.ts, schema.ts, db.ts, service.ts?}}`. `service.ts` only when a handler spans two stores. (L)
- A route handler is at most 10 lines; logic lives in `db.ts` or `service.ts`. No limit on routes per feature; split only by meaning. Export a type per feature and a precompiled client type (R). (L)
- Only `db.ts` and `infra/` touch drivers; only `upstreams/` call outside services, with a timeout. (L)
- All routes under `/api`, no version. Additive changes only. (R)
- Paths `/api/<plural-kebab>` and `/:id`; `GET` list, `POST` 201 + item, `GET /:id`, `PATCH /:id` 200 + item, `DELETE /:id` 204. No PUT. Actions `POST /api/<res>/:id/<verb>`. (L)
- Input only via `v()` from `lib/validate.ts` (built on hono-openapi `validator`), read only via `c.req.valid()`. (L)
- Every route has `describeRoute` with its response schemas from `schema.ts`. (L)
- OpenAPI spec `/api/openapi.json` and reference `/api/docs` (Scalar) are mounted only when `NODE_ENV` is development; production never serves them. (L)
- API tests check responses against the documented schemas. (R)
- Item: bare object. List: `{ items, nextCursor }`; `total` only when asked. Cursor paging only. Invalid input 400; `limit` clamped. (T)
- Error: `{ error: { code, message, issues?, requestId } }`, thrown as `ApiError(code)`. Codes: invalid_request 400, unauthenticated 401, forbidden 403, not_found 404, conflict 409, rate_limited 429, internal 500, upstream_error 502, unavailable 503, upstream_timeout 504. Unhandled = 500. `onError`/`notFound` only in `app.ts`, mapping in `lib/errors.ts`. (L/T)
- JSON camelCase, string ids, timestamps ISO named `*At`, fields always present (`null`, `[]`). (T/R)
- Auth: one session store; cookie for web, bearer for mobile and LIFF; `POST /api/sessions`, `DELETE /api/sessions/current`. `app.ts` applies auth to all of `/api/*`; public routes listed only in `src/middleware/public-routes.ts` (a fully public API lists `"/api/*"`); roles as route middleware; others' resources return 404. `csrf()` and JSON-only writes. (L/R)
- `Idempotency-Key` on POSTs that must not run twice. (R)
- Every log line and error carries `requestId`. (R)
- Tests via `testClient`. (L)

### LIFF (Vite)

- TanStack Router file routes in `src/app`, `validateSearch` = the feature params schema. (L)
- `main.tsx`: top-level `await liff.init`, then session exchange, then router, then render. (R)
- Send only the ID token to `POST /api/sessions`; the API verifies it with LINE. Session token in memory only. `@line/liff` >= 2.31.1. (R)

### Mobile (Expo)

- expo-router in `src/app`, `Stack.Protected` for auth. No `useFocusEffect`, no `Keyboard.addListener`, no RN `SafeAreaView`. (L)
- Styling Uniwind with shared tokens; primitives rn-primitives via `components/ui`. (L)
- Inputs uncontrolled by default, through `lib/form.ts`. Lists FlashList + `useSuspenseInfiniteQuery`. (R)
- Tests jest-expo + RN Testing Library. (R)

### Marketing (Astro)

- `src/pages/[locale]/`, components as `.tsx`; `.astro` only in `pages/` and `components/layout/`, thin. Env via `astro:env`. (L)

### Styling (all UI apps)

- Tailwind v4 only, tokens from `packages/tokens`. No inline `style`, no CSS files besides the one global. (L)

### Testing

- Agent verification (the repo's verify skill, real app end to end) is the required proof for every user-visible PR: screenshots or recording plus commands run, in the PR body. (R)
- Keep only: API route tests via `testClient` against a real local database (one per behavior: success, validation error, auth refused); one test per auth/permission guard that fails if the guard is removed; outside formats (LINE tokens, webhooks, upstream responses) as one table-driven test with recorded examples; logic with real branches (reducers, params parse, dates, pricing) as one table per function; 5-10 end-to-end keeper journeys per app. (R)
- Bug fixes: logic/data bug gets one test that fails before the fix, in an existing file; visual bug gets before/after screenshots and no test. (R)
- Before adding a test, the PR names the contract it protects, the realistic bug that breaks it, and why no existing test catches it. One behavior is tested in one place only. (R)
- Banned: sleeps, polling loops, real clock (`Date.now`, `new Date()` without fake timers), per-test timeouts, `.skip`/`.only`, tests inside loops, snapshot assertions, jsdom render-only component tests, tests whose only assertions are call checks (`toHaveBeenCalled*`), `vi.mock`/`jest.mock` of in-repo modules (mocks only for network, LINE SDK, `next/*`, time), tests in route folders, more than one test file per source file. (L)
- No coverage thresholds. Exports used only by tests fail knip. (L)
- CI comments when a PR adds more than 15 tests net or any new browser test file. (R)
- Affected-only runs on PRs and pre-push (`pnpm --filter "...[origin/develop]"`, `vitest --changed`, `jest --changedSince`); everything runs when lockfile, config or `packages/*` change; full suite after each merge to develop. (R)

### Types

- No chained type assertions such as `x as unknown as Y`. `as const` chains are allowed. (L)
- No runtime `typeof` narrowing. Parse at the boundary with zod. `typeof x === "undefined"` existence probes are allowed. (L)

### Git

- One PR = one squash commit on develop. Squash-merge only. Never merge to main. (R)

### Review

- Every (R) rule is checked by one automated AI review per PR, given this list, asking only for less, never more. (R)

## How lint enforces the (L) rules

Built-in rules come first. A `standard/<rule>` exists only where no built-in rule or per-glob override can express the check.

| Rule                                                                                                                                                              | Enforced by                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo shape, app layout, flat feature folders, feature file prefixes, API layout                                                                               | `standard/repo-shape`                                                                                                                                                                                                                                                                                                                                                                          |
| Feature import boundaries                                                                                                                                         | `standard/feature-imports`, plus `no-restricted-imports` so `lib/` and `components/` never import `@/features/*`                                                                                                                                                                                                                                                                               |
| Route files: no literal text, no tests, no data imports                                                                                                           | `react/jsx-no-literals`, `standard/repo-shape`, `no-restricted-imports` (`*.server`, `@/lib/api`, `next/headers`)                                                                                                                                                                                                                                                                              |
| Kebab-case names, named exports, no barrels                                                                                                                       | `unicorn/filename-case`, `import/no-default-export` (off for framework files), `oxc/no-barrel-file`                                                                                                                                                                                                                                                                                            |
| `@/` imports only                                                                                                                                                 | `no-restricted-imports` pattern                                                                                                                                                                                                                                                                                                                                                                |
| Tests as `*.test.ts(x)` next to their source, one per source, none in routes                                                                                      | `standard/repo-shape`                                                                                                                                                                                                                                                                                                                                                                          |
| `import/no-cycle`                                                                                                                                                 | `import/no-cycle`                                                                                                                                                                                                                                                                                                                                                                              |
| No comments, including disable directives and `@ts-*`                                                                                                             | `standard/no-comments`; repo-shape reports disable directives from another file                                                                                                                                                                                                                                                                                                                |
| Markdown only README.md and AGENTS.md                                                                                                                             | `standard/repo-shape`                                                                                                                                                                                                                                                                                                                                                                          |
| `t()` everywhere, dictionaries in `lib/i18n/messages/<feature>.ts`                                                                                                | `react/jsx-no-literals` with `restrictedAttributes` (`placeholder`, `aria-label`, `title`, `alt`), `standard/repo-shape`                                                                                                                                                                                                                                                                       |
| Owner files: env, console, JSON, Intl, timers, Hono client, TanStack Query, AI SDK, UI primitives, `useSyncExternalStore`                                         | `no-restricted-globals`, `no-restricted-properties` (including `window.*`, `globalThis.*`, `React.*`), `no-restricted-imports`, each switched off by glob for its owner; `standard/import-meta-env`                                                                                                                                                                                            |
| No effects, no `useState`                                                                                                                                         | `no-restricted-imports`, `no-restricted-properties` (`React.*`)                                                                                                                                                                                                                                                                                                                                |
| One `useReducer` per component, reducer from `<feature>-state.ts`                                                                                                 | `standard/reducer`                                                                                                                                                                                                                                                                                                                                                                             |
| Exhaustive reducer switch                                                                                                                                         | `typescript/switch-exhaustiveness-check`                                                                                                                                                                                                                                                                                                                                                       |
| No `fetch` outside `lib/api` and `upstreams/`                                                                                                                     | `no-restricted-globals`, `no-restricted-properties`                                                                                                                                                                                                                                                                                                                                            |
| Never `useQuery`                                                                                                                                                  | `no-restricted-imports`                                                                                                                                                                                                                                                                                                                                                                        |
| `*.server.ts` imports `server-only`; `'use cache'` calls `cacheTag` and `cacheLife`; no exported cached function takes a user id; tags in `<feature>-cache.ts`    | `standard/next-data`                                                                                                                                                                                                                                                                                                                                                                           |
| `queryOptions` in `<feature>-queries.ts`                                                                                                                          | `no-restricted-imports`                                                                                                                                                                                                                                                                                                                                                                        |
| Never `router.refresh()`                                                                                                                                          | `no-restricted-properties` (`router.refresh`), `standard/next-data` (other names, `useRouter().refresh()`)                                                                                                                                                                                                                                                                                     |
| `page.tsx` synchronous, `PageProps`, no top-level await; `layout.tsx` synchronous                                                                                 | `standard/next-routes`                                                                                                                                                                                                                                                                                                                                                                         |
| Layouts and pages never read session or data                                                                                                                      | `no-restricted-imports`                                                                                                                                                                                                                                                                                                                                                                        |
| No `loading.tsx`, parallel or intercepting routes, `_private` folders; `route.ts` only for webhooks and metadata; `error.tsx` per route group                     | `standard/repo-shape`                                                                                                                                                                                                                                                                                                                                                                          |
| Raw `Suspense` only in `components/boundary/section.tsx`                                                                                                          | `no-restricted-imports`, `no-restricted-properties`                                                                                                                                                                                                                                                                                                                                            |
| Server Actions only in `<feature>-actions.ts`, names end in `Action`, never inline                                                                                | `standard/server-actions`                                                                                                                                                                                                                                                                                                                                                                      |
| Only `lib/api` creates API clients                                                                                                                                | `no-restricted-imports` (`hono/client`)                                                                                                                                                                                                                                                                                                                                                        |
| Only `<feature>-params.ts` reads search params; no `useSearchParams` on web                                                                                       | `no-restricted-globals` (`URLSearchParams`), `no-restricted-properties` (`searchParams`, `useSearch`), `no-restricted-imports`                                                                                                                                                                                                                                                                 |
| Fixed param names; LIFF `validateSearch` is the params schema                                                                                                     | `standard/params`                                                                                                                                                                                                                                                                                                                                                                              |
| `new Hono` and `createFactory` only in `src/factory.ts`                                                                                                           | `no-restricted-imports`                                                                                                                                                                                                                                                                                                                                                                        |
| One chain per router, inline handlers, explicit `c.json` status, at most 10 lines, path shape, `describeRoute`, `c.req.valid()` only, OpenAPI only in development | `standard/hono`                                                                                                                                                                                                                                                                                                                                                                                |
| Drivers only in `db.ts` and `infra/`                                                                                                                              | `no-restricted-imports`                                                                                                                                                                                                                                                                                                                                                                        |
| No PUT                                                                                                                                                            | `no-restricted-properties` (`put` in `routes.ts`)                                                                                                                                                                                                                                                                                                                                              |
| Validators only in `lib/validate.ts`                                                                                                                              | `no-restricted-imports`                                                                                                                                                                                                                                                                                                                                                                        |
| `onError`/`notFound` only in `app.ts`                                                                                                                             | `no-restricted-properties`                                                                                                                                                                                                                                                                                                                                                                     |
| Public routes only in `src/middleware/public-routes.ts`                                                                                                           | `no-restricted-exports`                                                                                                                                                                                                                                                                                                                                                                        |
| Tests via `testClient`                                                                                                                                            | `no-restricted-properties` (`app.request` in tests)                                                                                                                                                                                                                                                                                                                                            |
| Expo bans                                                                                                                                                         | `no-restricted-imports`, `no-restricted-properties`                                                                                                                                                                                                                                                                                                                                            |
| Uniwind and rn-primitives                                                                                                                                         | `no-restricted-properties` (`StyleSheet.create`), `no-restricted-imports`                                                                                                                                                                                                                                                                                                                      |
| Marketing pages under `src/pages/[locale]/`, `.astro` only in `pages/` and `components/layout/`                                                                   | `standard/repo-shape`                                                                                                                                                                                                                                                                                                                                                                          |
| No inline `style`, one global CSS file, no CSS modules                                                                                                            | `react/forbid-dom-props`, `react/forbid-component-props`, `standard/repo-shape`                                                                                                                                                                                                                                                                                                                |
| Banned in tests                                                                                                                                                   | `standard/tests` (real clock without fake timers, polling loops, per-test timeouts, tests in loops, render-only and call-only tests, in-repo mocks), `vitest/no-focused-tests`, `vitest/no-disabled-tests`, `vitest/no-restricted-matchers` (snapshots), `vitest/no-restricted-vi-methods`, `no-restricted-properties` (`expect.poll`, `jest.setTimeout`), `no-restricted-imports` (`waitFor`) |
| No coverage thresholds                                                                                                                                            | `standard/tests` on vitest, vite and jest configs                                                                                                                                                                                                                                                                                                                                              |
| Exports used only by tests                                                                                                                                        | knip `--production`                                                                                                                                                                                                                                                                                                                                                                            |
| No chained type assertions (`x as unknown as Y`; `as const` chains allowed)                                                                                       | `standard/no-chained-assertions`                                                                                                                                                                                                                                                                                                                                                               |
| No runtime `typeof` narrowing; parse at the boundary with zod (`typeof x === "undefined"` probes allowed)                                                         | `standard/no-typeof`                                                                                                                                                                                                                                                                                                                                                                           |
