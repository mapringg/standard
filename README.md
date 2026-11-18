# @mapringg/standard

One oxlint config and one oxlint plugin that hold every rule for our repositories. There is no CLI and nothing to configure per repository: each repo extends the shared files and runs oxlint, oxfmt and knip.

The package ships:

- `oxlint.json`: the shared oxlint config, a few KB. Every built-in category is on as an error, with a short off-list.
- `src/plugin/`: the `standard` oxlint JS plugin. Path logic lives in the rules, so the config needs no per-app overrides. Owner files are one table in `src/plugin/owners.mjs`.
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

Run oxlint from the repo root.

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

`.githooks/pre-push` runs lint and the affected tests. Compare against `origin/main` when the repo has no develop:

```sh
#!/bin/sh
set -e
pnpm lint
pnpm --filter "...[origin/develop]" test
```

## App kinds

Rules find an app's kind from its structure, not its folder name, so any number of apps fit:

- Hono service: has `src/factory.ts`. `apps/api` and any extra service, such as `apps/email`, follow the API rules.
- Next web app: `next` in its `package.json`.
- Astro marketing site: `astro`.
- Expo mobile app: `expo`.
- Vite LIFF app: `vite`.

An app that matches none of these is reported.

## How the plugin reports repo-wide problems

oxlint only lints JS and TS files, so `standard/repo-shape` walks the repo once per run. It honours every nested `.gitignore` and reports files oxlint never opens (Markdown, CSS, folders) on the first linted file of the nearest folder. It can't call `git ls-files`, because child processes fail inside oxlint's workers.

`oxlint-disable` comments silence every rule in their file, including `standard/no-comments`. So repo-shape also reports disable directives, on a different file that has none.

## Categories and the off-list

`correctness`, `suspicious`, `perf`, `style`, `restriction` and `pedantic` are all on as errors. These rules are off, each because it contradicts the standard or misfires on the template:

| Rule                                                                                                    | Why it is off                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `import/no-named-export`, `import/prefer-default-export`, `import/group-exports`, `import/exports-last` | The standard uses inline named exports.                                         |
| `import/namespace`                                                                                      | Misreads re-exports such as `@rn-primitives/label`; the type checker covers it. |
| `import/no-namespace`                                                                                   | zod/mini is imported as `* as z`.                                               |
| `import/no-unassigned-import`                                                                           | `import "server-only"` and the global CSS import are required.                  |
| `react/react-in-jsx-scope`                                                                              | The automatic JSX runtime needs no React import.                                |
| `react/jsx-filename-extension`                                                                          | Components are `.tsx`.                                                          |
| `react/jsx-props-no-spreading`                                                                          | `components/ui` wrappers forward props to primitives.                           |
| `react/jsx-max-depth`                                                                                   | Layouts nest deeper than any fixed limit without being wrong.                   |
| `eslint/sort-keys`, `eslint/sort-imports`                                                               | oxfmt sorts imports; key order follows meaning.                                 |
| `eslint/func-style`, `eslint/one-var`, `eslint/curly`, `eslint/no-ternary`                              | Formatting taste, not correctness.                                              |
| `eslint/no-magic-numbers`                                                                               | HTTP statuses, limits and timeouts are clearest as literals.                    |
| `eslint/id-length`                                                                                      | `c` (Hono context), `t` (i18n) and `z` (zod) are the libraries' names.          |
| `eslint/no-undefined`, `unicorn/no-null`                                                                | API fields are always present as `null`; optional values are `undefined`.       |
| `unicorn/no-useless-undefined`                                                                          | zod/mini needs `undefined` as an explicit `z.catch` fallback.                   |
| `eslint/no-void`                                                                                        | `void promise` marks intentionally floating promises.                           |
| `eslint/require-await`, `typescript/require-await`                                                      | Hono handlers and Server Actions are `async` by convention.                     |
| `eslint/no-console`, `node/no-process-env`                                                              | `standard/owners` allows them in `lib/log.ts` and `lib/env.ts` only.            |
| `eslint/no-underscore-dangle`                                                                           | zod/mini's `z._default` is its API.                                             |
| `typescript/explicit-function-return-type`, `typescript/explicit-module-boundary-types`                 | The standard bans return types on implementations.                              |
| `typescript/prefer-readonly-parameter-types`                                                            | Flags nearly every library type.                                                |
| `typescript/no-confusing-void-expression`                                                               | Concise arrows that return void calls are fine.                                 |
| `typescript/explicit-member-accessibility`                                                              | Classes are rare and public by default.                                         |
| `typescript/consistent-type-definitions`                                                                | Module augmentation needs `interface`; everything else uses `type`.             |
| `oxc/no-async-await`, `oxc/no-rest-spread-properties`, `oxc/no-optional-chaining`                       | Old-runtime compatibility rules; the standard targets ES2024.                   |
| `unicorn/max-nested-calls`                                                                              | zod/mini schemas nest calls by design.                                          |
| `unicorn/prefer-top-level-await`, `promise/prefer-await-to-then`, `promise/valid-params`                | They read zod/mini's `z.catch(schema, fallback)` as a promise.                  |
| `node/callback-return`                                                                                  | Misreads Hono's `await next()` as a Node callback.                              |
| `node/no-top-level-await`                                                                               | LIFF `main.tsx` awaits `liff.init` at top level.                                |
| `vitest/require-test-timeout`                                                                           | The standard bans per-test timeouts.                                            |
| `vitest/prefer-expect-assertions`                                                                       | Noise on synchronous tests.                                                     |
| `vitest/no-importing-vitest-globals`                                                                    | Tests import from `vitest` explicitly.                                          |
| `vitest/require-top-level-describe`, `vitest/require-hook`, `vitest/no-hooks`                           | MSW setup lives in hooks; flat tests need no describe.                          |

The `react-perf` plugin is not enabled, because the React Compiler memoizes. CommonJS `*.config.js` files (Expo's metro and jest) turn off the CommonJS and unsafe-`any` rules. Generated `*.d.ts` files may use empty `export {}`. `eslint/new-cap` exempts Scalar's factory.

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

### Round 3 decisions (2026-11-18 23:30)

- Owner bans live in one `standard/owners` rule reading one table (thing -> owner paths); no restated built-in override lists. (L)
- Whole oxlint categories on (correctness, suspicious, perf, style, restriction, pedantic), with a short list switched off where they conflict. (L)
- Every rule message says what to do instead. (R for authors of the standard)
- Network in tests is faked only with MSW, `onUnhandledRequest: "error"`; no other test doubles (module mocks, `vi.fn(impl)`, stubbed globals). Observation-only spies allowed. (L)
- Test support files: only `*.test.ts(x)`, `*.fixture.ts`, `*.test-utils.ts`; no `helpers.ts`, `mocks.ts`, `*.spec.*`. E2E keepers in `apps/<app>/e2e/*.test.ts`. (L)
- No explicit return types on implementations; infer, use `satisfies` to pin a contract. (L)
- App kinds are detected by structure: Hono service (`src/factory.ts`; `api` plus any extra service such as `email`, all following the API rules), Next web, Vite LIFF, Expo mobile, Astro marketing. (L)
- Webhooks live in `features/webhooks/` and may read the raw body for signature checks. (L)
- Streaming routes (`streamSSE`, `streamText`) are exempt from the `c.json` status rule. (L)
- Marketing with one locale has no `[locale]` segment. (L)
- `packages/` holds only `tokens` and `i18n`; shared server helpers live in each app's `lib/`. (L)
- Skills: every repo has `pr` and `review-standard`; verify skills are per repo and not standardized. No `implement-figma-ui`.
- Workflows: `ci.yml` (affected-only), `deploy.yml` (reusable, environment input), `deploy-<env>.yml` callers.
- Pre-push and CI compare against `origin/develop`, or `origin/main` when a repo has no develop. (R)
- Marketing may pin its own TypeScript version for `astro check`; the only exception to one version per dependency. (R)
- The user's time zone is stored with the account in the API and sent at sign-in; servers render dates in it. (R)
- Owner files: if an app needs the thing, it lives at that path with that shape; apps don't carry unused owner files. (L for path, R for shape)
- `lib/query.ts` sets `retry: 1`. (R)
- Jobs are routes: `POST /api/jobs/<name>` in `features/jobs/`, protected by a service token, triggered by the platform scheduler (Kubernetes CronJob, Cloudflare Cron Trigger). No in-process schedulers. (L for location, R for the rest)
- `service.ts` only when one action touches more than one store or outside service. (R)

## How lint enforces the (L) rules

| Rule                                                                                                                                                                                                                                                                                                                      | Enforced by                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Monorepo shape, app layout by kind, flat feature folders, feature file prefixes, API layout (incl. `server.ts`, `client.ts`, `features/jobs/`, `features/webhooks/`), `packages/` only tokens and i18n                                                                                                                    | `standard/repo-shape`                                                                                                     |
| Feature import boundaries                                                                                                                                                                                                                                                                                                 | `standard/feature-imports`; `standard/owners` keeps `lib/` and `components/` from importing `@/features/*`                |
| Route files: no literal text, no tests, no data imports                                                                                                                                                                                                                                                                   | `react/jsx-no-literals`, `standard/repo-shape`, `standard/owners`                                                         |
| Kebab-case names, named exports, no barrels                                                                                                                                                                                                                                                                               | `unicorn/filename-case`, `import/no-default-export` (off for framework files), `oxc/no-barrel-file`                       |
| `@/` imports only                                                                                                                                                                                                                                                                                                         | `no-restricted-imports`                                                                                                   |
| Tests as `*.test.ts(x)` next to their source, one per source, none in routes; support files only `*.fixture.ts` and `*.test-utils.ts`; E2E keepers in `apps/<app>/e2e/*.test.ts`                                                                                                                                          | `standard/repo-shape`                                                                                                     |
| `import/no-cycle`                                                                                                                                                                                                                                                                                                         | `import/no-cycle`                                                                                                         |
| No comments, including disable directives and `@ts-*`                                                                                                                                                                                                                                                                     | `standard/no-comments`, plus repo-shape for disable directives                                                            |
| Markdown only README.md and AGENTS.md                                                                                                                                                                                                                                                                                     | `standard/repo-shape`                                                                                                     |
| `t()` everywhere, dictionaries in `lib/i18n/messages/<feature>.ts`                                                                                                                                                                                                                                                        | `react/jsx-no-literals` with `restrictedAttributes`, `standard/repo-shape`                                                |
| Owner files and their bans: env, console, JSON, Intl, timers, fetch, Hono client, TanStack Query, AI SDK, UI primitives, `useSyncExternalStore`, effects, `useState`, `Suspense`, `queryOptions`, search params, Expo bans, Hono factory, validators, drivers, `onError`/`notFound`, public routes, PUT, `router.refresh` | `standard/owners` (one table, covering `window.*`, `globalThis.*` and `React.*` forms)                                    |
| One `useReducer` per component, reducer from `<feature>-state.ts`                                                                                                                                                                                                                                                         | `standard/reducer`                                                                                                        |
| Exhaustive reducer switch                                                                                                                                                                                                                                                                                                 | `typescript/switch-exhaustiveness-check`                                                                                  |
| `*.server.ts` imports `server-only`; `'use cache'` calls `cacheTag` and `cacheLife`; no exported cached function takes a user id; tags in `<feature>-cache.ts`; no `useRouter().refresh()`                                                                                                                                | `standard/next-data`                                                                                                      |
| `page.tsx` and `layout.tsx` synchronous, `PageProps`, no top-level await                                                                                                                                                                                                                                                  | `standard/next-routes`                                                                                                    |
| No `loading.tsx`, parallel or intercepting routes, `_private` folders; `route.ts` only for webhooks and metadata; `error.tsx` per route group                                                                                                                                                                             | `standard/repo-shape`                                                                                                     |
| Server Actions only in `<feature>-actions.ts`, names end in `Action`, never inline                                                                                                                                                                                                                                        | `standard/server-actions`                                                                                                 |
| Fixed param names; LIFF `validateSearch` is the params schema                                                                                                                                                                                                                                                             | `standard/params`                                                                                                         |
| One chain per router, inline handlers, explicit `c.json` status (streaming routes exempt), at most 10 lines, path shape, `describeRoute`, `c.req.valid()` only (webhooks may read the raw body), OpenAPI only in development                                                                                              | `standard/hono`                                                                                                           |
| Marketing pages under `src/pages/[locale]/` when there is more than one locale; `.astro` only in `pages/` and `components/layout/`                                                                                                                                                                                        | `standard/repo-shape`                                                                                                     |
| No inline `style`, one global CSS file, no CSS modules                                                                                                                                                                                                                                                                    | `react/forbid-dom-props`, `react/forbid-component-props`, `standard/repo-shape`                                           |
| Banned in tests: real clock, polling, per-test timeouts, loops, render-only and call-only tests, test doubles other than MSW, MSW without `onUnhandledRequest: "error"`, coverage thresholds                                                                                                                              | `standard/tests`, `standard/owners` (`expect.poll`, `waitFor`, `jest.setTimeout`, `app.request`)                          |
| `.only`/`.skip`, snapshots, `vi.waitFor`/`vi.waitUntil`/`vi.setConfig`                                                                                                                                                                                                                                                    | `vitest/no-focused-tests`, `vitest/no-disabled-tests`, `vitest/no-restricted-matchers`, `vitest/no-restricted-vi-methods` |
| Exports used only by tests                                                                                                                                                                                                                                                                                                | knip `--production`; `knip.json` ignores per-feature route types in `routes.ts`                                           |
| No explicit return types on implementations                                                                                                                                                                                                                                                                               | `standard/no-return-types`                                                                                                |
| No chained type assertions                                                                                                                                                                                                                                                                                                | `standard/no-chained-assertions`                                                                                          |
| No runtime `typeof` narrowing                                                                                                                                                                                                                                                                                             | `standard/no-typeof`                                                                                                      |
| Whole categories                                                                                                                                                                                                                                                                                                          | `correctness`, `suspicious`, `perf`, `style`, `restriction`, `pedantic`                                                   |
