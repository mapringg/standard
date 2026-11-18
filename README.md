# standard

One repository standard for every project: lint rules, repository checks, and a score that reports what each repository is missing.

## Use

Add the package at a tag and install its hooks when the repository installs:

```json
{
  "scripts": { "prepare": "standard install" },
  "devDependencies": { "@mapringg/standard": "github:mapringg/standard#v0.15.0" }
}
```

`standard install` writes three hook shims into the `.git/hooks` folder that all worktrees share and unsets `core.hooksPath`. Each shim calls `node_modules/.bin/standard`. A worktree whose checkout has `.standard/config.json` but no `node_modules` fails the hook. A worktree without `.standard/config.json` and without `node_modules` skips the hook, so installing in one worktree does not break another worktree of the same clone that is on a branch from before the repository adopted the standard. Commit `.standard/config.json`, even as `{}`, so the hooks know the repository has adopted; the `config-file` probe fails until you do.

| Command | What it does |
| --- | --- |
| `standard check [<name>...]` | Runs every check. In GitHub Actions it reads the pull request or push from `GITHUB_EVENT_PATH`, so check out with `fetch-depth: 0`. A `pull_request` event runs the commit, pull request and tree checks in one process. |
| `standard check --pr <number>` | Runs the same checks locally on a pull request that `gh pr view` reads. It fetches the pull request's base and head commits from `origin` when the clone lacks them. |
| `standard explain [<check> \| --markdown]` | Prints what each check enforces, the fix it names, its config keys, the version that added it and whether it keeps a baseline. See [Checks](#checks). |
| `standard hook commit-msg <file>` | Checks the commit message. |
| `standard hook pre-commit` | Runs the `hooks.pre-commit` lines. |
| `standard hook pre-push` | Refuses a merge commit that `origin/develop` lacks, then runs the `hooks.pre-push` lines. |
| `standard merge <number> [--admin]` | Squash-merges a pull request into `develop` once its newest `Check` run is green and its title and description pass `pr-title`, `pr-body` and `pr-screenshot` with no warning. See [Merge](#merge). |
| `standard score [<path>...] [--remote] [--json]` | Reports how far each repository follows the standard. See [Score](#score). |

## Checks

`standard explain --markdown` writes this table from the check registry, and a test fails when it drifts. `standard explain <check>` prints one check in full.

<!-- explain:start -->
| Check | Enforces | Fix | Config | Since | Baseline-free |
| --- | --- | --- | --- | --- | --- |
| `commit-subject` | Each commit message is one subject line: a capital imperative verb, three or more words and at most 80 characters, with no prefix, trailing period, body or trailers. The commit-msg hook and a push to develop or main fail a broken subject, and a push also needs its pull request number. On a pull request a broken subject only warns, and a merge commit fails. | Reword the subject the finding names, drop the body and trailers, and rebase away merge commits. | none | 0.1.0 | yes |
| `pr-title` | The pull request title follows the commit subject rules, counting the ` (#<number>)` the squash adds. | Retitle the pull request, since the title becomes the squash commit's subject. | none | 0.2.0 | yes |
| `pr-body` | The description follows the template: Summary, Evidence with a Before and After, and Merge Danger with Door and a one-word Blast Radius. It warns and never fails; `standard merge` enforces it. | Fill in the section or line the warning names. | `pr.ticket-prefix` | 0.2.0 | yes |
| `pr-screenshot` | A pull request that changes a file matching `pr.screenshots.when` has an image in Evidence. Files no page renders never ask for one: `.oxlintrc*`, `.oxfmtrc*`, `tsconfig*.json`, `*.test.*` and anything in `__tests__`. It warns; `standard merge` enforces it. | Upload a screenshot with the `pr.screenshots.uploader` script and add it to Evidence, or exclude a tooling folder with a `!` entry in `when`. | `pr.screenshots` | 0.2.0 | yes |
| `pr-size` | Reports the pull request's size from its changed lines, leaving out the lockfile, renames and binaries, and tests unless only tests changed. With `GH_TOKEN` and `GITHUB_REPOSITORY` set it labels the pull request `size:XS` to `size:XXL`. It never fails. | Split a large pull request into a stack. | none | 0.3.0 | yes |
| `baseline-growth` | A pull request does not add a check to `pending`, create or grow a baseline, or raise or remove a `budgets` entry, and `.standard` tracks no symlink. A budget starts in the pull request that removes `docs` from `pending`, in a pin bump that brings `docs`, or with the first doc of its kind. The pull request that removes a check from `pending` may start its baseline. A pin bump may add the checks its new version introduced, and the pull request that first installs the standard may add any. | Fix the new findings instead of recording them. | `pending`, `budgets` | 0.2.0 | yes |
| `wiring` | The repository runs the standard: a CI Check job runs `standard check`, `package.json` pins the package exactly, the install matches the pin, `prepare` runs `standard install`, git tracks `.standard/config.json`, `CLAUDE.md` is `@AGENTS.md` when present, and git tracks no script a check retires unless that check is pending. `standard score`, not this check, reads the installed hooks. | Make the change the probe names, such as deleting a retired script. | `pending` | 0.4.0 | yes |
| `dead-code` | knip finds no unused file, export, type or dependency, and no unlisted dependency. | Delete the unused code or dependency, or add the missing one. | none | 0.8.0 | yes |
| `duplicates` | No two function bodies or conditional expressions of 8 or more AST nodes match once types are dropped and the names they declare are renamed. A function whose body is one call passing only its parameters, plain member reads on them, literals, and arrays or objects of those is a forwarding adapter and never counts. It reads tracked `.ts` and `.tsx` files, except `.d.ts`, `*.test.*`, `*.spec.*`, `*.stories.*` and `test`, `tests`, `__tests__`, `fixtures`, `fixture` and `__fixtures__` folders, and each React app's `src/lib/swr.ts` and `src/lib/timer.ts`, which copy the package templates. | Move the shared logic to the module that owns it and import it everywhere. | none | 0.8.0 | yes |
| `typecheck` | Each TypeScript project loads the shared strict tsconfig and keeps its flags. The root and each project's `package.json` have a real `typecheck` script, `hooks.pre-push` runs `pnpm typecheck`, and the CI Check job runs it. The check reads configs and wiring; it does not type-check source, which the script does. | Add the shared base to `extends`, remove the overriding flag, or add the script, pre-push line or CI step the finding names. | `hooks.pre-push` | 0.9.0 | yes |
| `tests` | The repository's test command exists, runs before a push, and runs in CI where a failure blocks the merge. | Add the test script, the `pnpm test` pre-push line or the CI step the finding names. | `hooks.pre-push` | 0.10.0 | yes |
| `pr-tests` | A pull request that adds logic to a package's source adds or changes a test in that package. | Add or change a test in the package that covers the new logic. | none | 0.10.0 | yes |
| `boundaries` | An import respects the package, module and forbid boundaries the repository draws. | Import through the module's entry or the package's exports, or move the code. | `boundaries` | 0.11.0 | yes |
| `banned` | A file uses no API the repository bans, no file outside tests imports the swr template's SWRTestCache, and no React effect hook outside tests, the timer template and listed wrappers, which call one but never pass it on. No file reads React's namespace whole or at a key that is not a constant, and no oxlint config bans APIs a second way. | Use what the entry's `fix` names instead, replace an effect with what it does, export only hooks that call an effect hook, and name each React export you read. | `banned`, `effect-wrappers` | 0.12.0 | yes |
| `react` | A component or hook calls `useState` at most once and never for a `loading`, `isLoading`, `error` or `isError` flag. Each `useReducer` state is a union whose members have different `status` literals. Only each React app's `src/lib/swr.ts` imports swr. | Hold more than one value in a `useReducer` with a status union, and use the `src/lib/swr.ts` hooks instead of swr. | none | 0.12.0 | no |
| `client-data` | Only a file that `client-data` lists, with its reason, calls `useSWR`, from the app's `src/lib/swr.ts` under any of its names or from swr itself. A `"use client"` file that it does not list reads no `fetch` or `XMLHttpRequest`, imports no `ky` or `axios`, and imports no module that `api-modules` matches, directly or through modules without a directive. Tests, stories and fixtures are exempt. | Read data in a Server Component and pass it as props, and write through a Server Action, or list the file in `client-data` with why the browser must load it. | `client-data`, `api-modules` | 0.14.13 | no |
| `route-await` | The default export of a Next `app/**/page.*` or `app/**/layout.*` awaits nothing but its `params` and `searchParams` props, through any local or destructuring that holds them. Awaits inside nested functions, other exports such as `generateMetadata`, and tests are not counted. | Move the read into a small async component that awaits it inside `<Suspense>`, or start the request without `await` and pass the promise down. | none | 0.14.14 | no |
| `use-promise` | In a `"use client"` file, React's `use` reads a prop of an exported component or hook, an element of a list one of these holds, a parameter whose callers in the file pass one of these, the result of a function from a module that `cached-modules` lists, or a value made once at module level, such as a context. It never reads a call or `new` that the render makes, through any local. A value whose origin the check cannot trace fails. | Take the promise as a prop from a Server Component, or call a function from a module that `cached-modules` lists. | `cached-modules` | 0.14.15 | no |
| `suspense-errors` | A `<Suspense>` in a file under a Next app's `app` folder, and each `loading.*` there, sits under an error boundary: an `error.*` in its route segment or a parent, a `global-error.*` at the app root, or a component around it in the same file that `error-boundaries` lists or `catchError` makes. A layout's or template's own segment's `error.*` does not count. | Add an `error.tsx` to the segment or a parent, or a `global-error.tsx` for the root layout, or wrap the `<Suspense>` in a listed or `catchError` error boundary. | `error-boundaries` | 0.14.16 | no |
| `cache-components` | Each Next app's `next.config.*` exports `cacheComponents: true` at its top level, read from the AST through local names, spreads, plugin calls and config functions. A config the check cannot read fails. | Set `cacheComponents: true` at the top level of the exported config. Stage the check in `pending` until the switch lands. | none | 0.14.17 | yes |
| `no-comments` | Source holds no comments except reasoned directives, `SAFETY:` above a type assertion, `See:` pointers to a conventions or external doc or one of its headings, and a leading `SPDX-License-Identifier` or `@license` tag that names a license expression alone. An `.astro` component's markup holds no HTML comment, and its expressions follow the same rules. `next-env.d.ts` and files that `.gitattributes` marks `linguist-generated` or `linguist-vendored` are skipped. | Move the why into a name, test or type. For a generated file, mark its path `linguist-generated` in `.gitattributes`; for third-party code with a license notice, mark it `linguist-vendored`. | none | 0.13.0 | yes |
| `docs` | Every tracked Markdown file is a kind of doc the standard names by path, carries no `check-docs: external` marker, and is reached by links from an AGENTS.md, a CLAUDE.md, `.gemini/styleguide.md` or a SKILL.md unless it is a README or a pull request template. A file named like a log or plan fails in any folder. The paths, links, heading anchors, `pnpm` scripts and code symbols a doc names exist; an external doc's are checked only for links and paths under a tracked top-level entry. Each kind with docs has a line budget in `budgets` and fits it. | Move, delete, link, correct or cut the doc as the finding says. | `budgets` | 0.15.0 | yes |
| `docs-prose` | Docs of every kind use no en or em dash and none of a fixed list of filler words outside code, headings in sentence case, and prose sentences of at most 40 words, where a code span or a link is one word. A capitalized heading word passes when it is all capitals, has an inner capital or dot, starts a sentence, or some doc's prose writes it capitalized mid-sentence. The headings `pr-body` requires pass. | Rewrite the sentence or heading as the finding says. | none | 0.15.0 | no |
| `no-doc-pointers` | Source holds no `See:` comment that points at a doc, which `no-comments` still allows. Its baseline records today's pointers, so none can be added and each one deleted stays deleted. It skips the files `no-comments` skips. | Put the decision in a name, a type or a test, and delete the pointer. | none | 0.15.0 | no |
| `config` | Config uses known rule ids and every exception glob changes a finding. | Delete unused exceptions and keep plugin rules enabled in oxlint. | `allow` | 0.16.0 | yes |
<!-- explain:end -->

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

`pr-screenshot` warns when the pull request changes a file that matches a `pr.screenshots.when` glob, which git matches as a `:(glob)` pathspec (so `**` crosses folders, `*` does not, and dotfiles count), and no `when` entry that starts with `!` excludes it, and the Evidence section has no image. A file no page renders never asks for one: `.oxlintrc*`, `.oxfmtrc*`, `tsconfig*.json`, a `*.test.*` file, and anything in a `__tests__` folder. A `test` or `scripts` folder can be a page route, so it still asks; exclude a tooling folder with a `!` entry in `when`. The message names `pr.screenshots.uploader`. Without `pr.screenshots` the check does not apply. Like `pr-body`, it warns in CI and `standard merge` enforces it.

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
| `retired` | Git tracks a script that a check or command replaces, such as `scripts/check-commit-msg.mjs`, or a file that matches a glob it replaces. A script that several checks replace fails only once none of them is pending. The scripts `standard merge` replaces always fail, because `pending` names only checks. |
| `ci` | No workflow that runs on every `pull_request` to `develop` has a job whose check run is named `Check`, which `standard merge` waits for, with no `if`, `continue-on-error`, `strategy.matrix`, `defaults.run.shell` or `GITHUB_` variables in `env`, that uses `actions/checkout` with `fetch-depth: 0` and later has a step whose whole `run` is `standard check`, `pnpm exec standard check`, `pnpm standard check` or `npx standard check`, with no `shell`, `GITHUB_` variables, `if` or `continue-on-error`. On `pull_request`, `paths` and `paths-ignore` fail, `branches` or `branches-ignore` must let `develop` through under GitHub's glob rules, and `types` must include `opened`, `synchronize` and `reopened`. The fix names the first thing the closest workflow lacks. The probe catches wiring mistakes; whoever edits a workflow can still defeat it, and that edit shows in the pull request diff. |
| `pin` | `package.json` does not pin `@mapringg/standard` to an exact version, such as `0.5.0`, or a tag, such as `github:mapringg/standard#v0.5.0`. |
| `installed` | `node_modules/@mapringg/standard` is missing or holds a version other than the exact pin in `package.json`, so `pnpm install` has not run since the pin changed. |
| `prepare` | `scripts.prepare` does not start with `standard install` or `pnpm exec standard install`, followed by nothing or by ` && `. |
| `config-file` | Git does not track `.standard/config.json`. Commit it, even as `{}`, so the hook shims know the repository has adopted the standard. |
| `claude-md` | `CLAUDE.md` exists and is not exactly `@AGENTS.md` and a newline. |

Each finding's fix names the change, such as `Delete scripts/merge-pr.mjs, which standard merge replaces.`

`dead-code` runs knip 6.45.1 from the package's own install at the repository root, so the repository's `knip.json` applies and the repository needs no knip of its own. Each knip issue is one finding, named by the file, the knip issue type and the name, such as `src/a.ts exports parse`. Its fix names the change, such as `Unused export parse in src/a.ts:12. Delete it, or drop the 'export' keyword if only this file uses it.` A knip report of another shape, such as a row without its issue lists, fails the run and names the knip version. The check does not apply when git tracks no `package.json`. It replaces `scripts/check-dead-code.mjs`, its test and `scripts/baselines/dead-code.json`.

`duplicates` fails on code that repeats. It parses the `.ts` and `.tsx` files git tracks, except `.d.ts`, `*.test.*`, `*.spec.*`, `*.stories.*` and anything under a `test/`, `tests/`, `__tests__/`, `fixtures/`, `fixture/` or `__fixtures__/` folder. It also skips each React app's `src/lib/swr.ts` and `src/lib/timer.ts`, since every app copies the same package template. It replaces `scripts/check-duplicates.mjs`, its test and `scripts/baselines/duplicates.json`.

| Rule | What it means |
| --- | --- |
| Unit | A function body or a conditional expression with 8 or more AST nodes. |
| Same | Two units match once types are dropped and the names each unit declares are renamed in order. Literals, property names and names from outside the unit must be equal. |
| Adapter | A function whose body is one call that passes only its parameters, non-computed member reads on them such as `event.target.value`, literals, and arrays or objects of those, such as `(event) => dispatch({ type: "search", query: event.target.value })`, is never a unit. A computed callee or member such as `pick(open).dispatch(...)` or `event.target[field]`, a call in an argument, a name from outside the function in an argument, or a parameter with a computed key or a non-literal default keeps it a unit. |
| Nesting | A copy inside a larger reported copy is not reported again. |
| Finding | Each copy is one finding, named by the file and the symbol path, such as `src/form.tsx#Form>submit`, with `@2` on the second copy that shares a path. Its fix names the other copies with their lines. |

`typecheck` makes each TypeScript project build on the shared strict tsconfig and run its typecheck. A project is a tracked `tsconfig.json` or `tsconfig.*.json`, except a solution file, which has no input files and no error. The check does not resolve `extends` itself. It asks the TypeScript that each project's folder resolves, so it reads a config exactly as `tsc` does: the native API for TypeScript 7 and the compiler API before it. It does not apply when git tracks no tsconfig.

| Rule | Fails when |
| --- | --- |
| Compiler | No `typescript` package resolves from the project's folder. |
| Config | TypeScript reports an error for the config itself, such as an `extends` target it cannot find. The finding quotes it. |
| Base | TypeScript never loads `config/tsconfig.json` of `@mapringg/standard` for the project. |
| Flags | The project's effective value of a base `compilerOptions` flag differs from the base. A project that inherits the problem from another project is not reported again. |
| Scripts | The root `package.json` has no `typecheck` script, or the `package.json` nearest a project has none, which `turbo run typecheck` would skip. A script that is empty, `true`, `:`, `exit 0` or an `echo` counts as none, since it checks nothing. |
| Hooks | No `hooks.pre-push` line is exactly `pnpm typecheck` or `pnpm run typecheck`. Anything before or after it, even `&&`, could skip it or hide its failure, so a chain goes on its own lines. |
| CI | No step of the Check job without `continue-on-error` or `shell` has a `run` that is exactly that command. A step may have an `if`, such as one that skips a draft, but not a constant false such as `false`, `0`, `''` or `${{ false }}`, which GitHub never runs. When the `ci` probe finds no Check job, this rule stays quiet. |

`tests` checks that the repository's test command runs before a push and in CI. A test file is a tracked `*.test.*` or `*.spec.*` file with a `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs` or `.cjs` extension. It does not apply when git tracks no `package.json`.

| Rule | Fails when |
| --- | --- |
| Script | The root `package.json` has no `test` script. A script that is empty, `true`, `:`, `exit 0` or an `echo` counts as none, since it runs no test. |
| Packages | The `package.json` nearest a test file has no `test` script, so `turbo run test` skips that package. The fix names one test file it would never run. |
| Hooks | No `hooks.pre-push` line is exactly `pnpm test` or `pnpm run test`, so nothing in the line can swallow a failure. `pnpm test:visual`, `pnpm turbo run test` and `pnpm lint && pnpm test` do not count. |
| CI | No step of the Check job without `continue-on-error` or `shell` has a `run` that passes the same command rule. A step may have an `if`, but not a constant false. When the `ci` probe finds no Check job, this rule stays quiet. |

`pr-tests` fails a pull request that adds logic to a package's source and adds no test to that same package. It diffs the head against the merge base of the base and head, reads both sides from git, and parses each changed file.

| Rule | What it means |
| --- | --- |
| Source | A `.ts`, `.tsx`, `.mts` or `.cts` file under a `src/` folder, except `.d.ts`, test files, `*.stories.*`, `*.gen.*`, and anything under a `test/`, `tests/`, `__tests__/` or `generated/` folder. |
| Test | A test file, as `tests` defines it, anywhere. Each `it` or `test` call whose callback has a body is one test, at the top level or inside a `describe` or `suite` callback. `.each(...)`, `.concurrent` and `.sequential` may follow the name. A call marked `.skip`, `.todo`, `.only`, `.fails`, `.skipIf` or `.runIf`, an `xit`, `xtest`, `xdescribe`, `fit` or `fdescribe`, and a call with a `skip`, `todo` or `only` option are not tests, and neither is anything inside them. |
| Package | The folder of the nearest `package.json` that git tracks at the head, `.` for the root. |
| Logic | A top-level statement, with `export` unwrapped, as the JavaScript it emits. Positions, comments, types, casts and the modifiers TypeScript erases, such as an optional parameter's `?`, `abstract`, `readonly`, `override` and `private`, are dropped. Decorators, enums, parameter properties and namespaces that hold code stay. Imports, re-exports, type-only statements, `declare` statements and fields, overloads, abstract members and inert data are not logic. Inert data is a variable or `export default` built only from literals, names, templates, arrays, objects with plain or literal keys, and `as const`, such as a table of reviews that names an imported photo. A property read, a spread, a call or a `delete` can run code, so it is logic. |
| Adds | Each package sums its changed files, deleted and renamed ones included. The head's statements count up and the merge base's count down, and a statement with a positive total is added, so each extra copy of a statement counts. Deleting code, dropping an `export` keyword, changing imports, types, comments or formatting, renaming a file and moving code between files of one package add nothing. Moving code into another package adds it there. Tests count the same way, so a moved or renamed test adds none, and editing a test's name or body adds one. A source that does not parse adds logic; a test that does not parse adds none. |
| Finding | Each package that adds logic and no test is one finding, named by the package folder. Its fix names the sources that hold the added logic and a co-located test name, such as `apps/api/src/a.test.ts`. |

Neither check measures coverage; `pr-tests` asks only that a test changed beside the logic.

`boundaries` fails an import that crosses a boundary the repository draws. It parses the `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` and `.astro` files git tracks and reads, from the syntax tree, the specifier of each import declaration, `export ... from`, `import x = require()`, and `import()` or `require()` of a string or a template without expressions. A `require()` call reads the nearest binding of its callee, so a parameter or a local of the same name shadows it, as in JavaScript. A `const` loader that `createRequire` makes resolves from its anchor when the anchor is a string, `import.meta.url`, `__filename` or `new URL("<literal>", import.meta.url)`. That holds under any name, when `createRequire` is imported from `node:module` or read from a `const` of it. These are not read: an `import()` or `require()` of a computed value; a call inside a `with` block; and a call through a loader with a computed anchor, one declared with `let` or `var` or destructured, or one that a destructured `createRequire` makes. A type-only import counts, because it ties the importer to the file the same way. Run `pnpm install` first, so workspace packages and the compiler resolve.

Each file resolves as the TypeScript of its project does, the project being its nearest tracked `tsconfig.json`, read by the `typescript` that folder resolves. Before TypeScript 7 the check calls that compiler's `resolveModuleName` with the project's options. TypeScript 7 exposes no `resolveModuleName`, so the check asks its checker for the module each import names. For each project it opens two configs, in memory only, that extend the project's `tsconfig.json`, allow JavaScript, and list every file the project owns: one as written, and one without `paths` for the packages rule. The file of the module the checker returns is the target, so `exports`, versioned `types@` conditions, `typesVersions` and `imports` resolve as that compiler resolves them. A `require()` in a TypeScript file, which TypeScript does not read, resolves as Node runs it. Before TypeScript 7, and for Node, the import site picks the `import` or `require` condition: `require()` and `import x = require()` are `require`, `import()` is `import`, and under `node16` or `nodenext` a declaration follows its file's format, from its extension or the nearest `package.json` `type`. A file outside any TypeScript project or in one whose folder resolves no `typescript`, and a `createRequire` call, resolve as Node runs them, through oxc-resolver 11.24.2. An asset such as `./globals.css`, which TypeScript does not resolve, is found as a file, through `paths` too.

| Rule | Fails when |
| --- | --- |
| Packages | An import lands in another workspace package, the folder of the nearest tracked `package.json`, without naming that package, such as `../api/src/db.ts` from `apps/web`, or names it but reaches a file its `exports` do not resolve the specifier to, such as a tsconfig `paths` alias `api/hidden`. A package without `exports` allows only its bare name. Needs no config. |
| Modules | A file imports a file inside a module it is not in, other than one of the module's entries. Each `boundaries.modules` rule names `folders`, globs whose matching folders are modules, and `entries`, file names without extension that sit directly in a module folder, such as `index`. The innermost module folder owns a file. A folder that matches `open` is a module anyone may import from. An importer that matches `except` is exempt. Applies only within one workspace package, since `exports` guards the way in from outside. |
| Forbid | A file that matches a `boundaries.forbid` rule's `files` and none of its `except` globs imports a file that matches its `imports`. The finding ends with the rule's `fix`. |
| Parse | A file does not parse. |
| Unresolved | A relative, absolute or `#` import does not resolve, or a bare one does not resolve and either names a workspace package, directly or through an alias whose `node_modules` link leads into the repository, or neither the importer's `package.json` nor the root `package.json` declares its package. A workspace package's subpath outside its `exports` fails here. A specifier with a scheme, such as `node:fs` or `cloudflare:test`, and a Node builtin are skipped. |

Globs are repository paths matched against the resolved file, extension included, with `path.matchesGlob`. A glob that starts with `/`, has a `..` segment, or leaves a `[` or `{` open fails every command. Each finding is one import, named by the file and the specifier, such as `apps/web/src/a.ts imports ../api/src/db.ts`. It replaces each workspace plugin's `module-boundaries` and `no-restricted-import-paths` rules, so `wiring` asks to delete `packages/oxlint-plugin-*/rules/` files of those names and their tests; remove the rules from the plugin and the oxlint configs in the same pull request. A package ban such as `zod` against `zod/mini` goes in `banned`, whose `import` entry matches the exact module name and skips type-only imports.

```json
{
  "boundaries": {
    "modules": [
      { "folders": ["apps/api/src/*", "apps/api/src/features/*"], "entries": ["index", "routes"], "open": ["apps/api/src/db"], "except": ["**/*.test.ts"] }
    ],
    "forbid": [
      { "files": ["apps/web/src/features/**"], "imports": ["apps/web/src/app/**"], "fix": "Let the route compose the feature." }
    ]
  }
}
```

`banned` fails a file that uses an API its repository bans. Each entry in the `banned` list of `.standard/config.json` names the API with exactly one of `import`, `global` or `property`, as a string or a list, and says what to use instead in `fix`. `files` lists the globs it covers, every tracked source when absent, and `except` lists the globs inside them where the API is allowed. A use counts once, for the first entry that covers its file. A source is a `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` or `.astro` file that git tracks outside `node_modules`, except `.d.ts`. An `.astro` component counts as the TypeScript in its `---` frontmatter and in each `<script>` a browser runs, read on the component's own lines. The Astro compiler finds them, so a `---` line inside a frontmatter string does not end the frontmatter, and `<script>` text inside a markup string or an attribute is not a script. A script runs when its `type` is absent, empty, `module` or a JavaScript MIME type. That includes `is:inline` scripts, scripts inside a `{}` expression, and `define:vars` scripts, whose body Astro runs with the variables in scope. Its markup, `{}` expressions in the markup, HTML comments, `<style>` blocks, a capitalized `<SCRIPT>`, which Astro reads as a component, scripts whose `type` is data, such as `application/ld+json`, or an expression, and self-closing scripts without `set:html` or `set:text` are not read. A quoted `set:html` or `set:text` on a runnable script replaces its body, so the check reads that value instead. A `<script>` inside `<noscript>` never runs, so it is skipped. A `set:html` or `set:text` expression on a runnable script, an unquoted value or one that holds an HTML character reference such as `&quot;`, and a frontmatter with no closing `---` fail as files the check cannot read. The frontmatter may `return`, as Astro allows.

Every repository also bans module mocking, which no entry, `except` or config turns off: `vitest#vi` and `@jest/globals#jest` with `.mock`, `.doMock`, `.unmock` or `.unstable_mockModule`, and the same calls on the unbound globals `vi` and `jest` that vitest globals mode provides. Its fix says to pass the dependency in as an argument or prop, or run a fake of the service it calls.

Every repository also bans React's effect hooks, `react#useEffect`, `react#useLayoutEffect` and `react#useInsertionEffect`, through every form the `import` rule follows, a named re-export included. Code that never ships may use them: `*.test.*`, `*.spec.*` and `*.stories.*` files in any language, `.jsx` included, and anything under a `test/`, `tests/`, `__tests__/`, `fixtures/`, `fixture/` or `__fixtures__/` folder, the same files `duplicates` skips. So may each React app's `src/lib/timer.ts`, and each file that `effect-wrappers` in `.standard/config.json` lists with its `reason`. `src/lib/swr.ts` calls no effect hook, so it needs no exemption. The reason is required, and the file is an exact repository path. A wrapper is rare, such as a seam to an imperative library that renders no element, or a DOM measurement hook.

An exempt file may import an effect hook and call it, and export the hooks that call it, but never pass the hook itself on, since product code could then call it unseen. Any other use of the hook fails in that file. That covers an export by name, alias or default, `export import`, and a local or TypeScript `import` alias that holds it. It also covers a function that returns it, an object that holds it, and a member such as `.bind`. Its fix says to export only the hooks that call it. Every file, exempt or not, fails when it re-exports react's namespace with `export *`, `export * as` or the namespace or default binding. Every file also fails when it reads the namespace whole, where banned cannot tell which hook it takes. That is an argument such as `Reflect.get(React, name)` or `Object.values(React)`, a spread or an object, a destructuring rest, or the promise of an `import("react")` that is not awaited. A `const` that holds the namespace, `const { useState } = React` and `<React.Fragment>` pass.

A computed key on the namespace counts as the export it names when it is a constant: a literal, a template or a `+` of constants, or a `const` that holds one. So `const name = "useEffect"; React[name]()` and ``React[`use${"Layout"}Effect`]()`` fail as the hook they name, and `React[name](0)` with `name` a `const` of `"useState"` passes. A key only runtime knows, such as a parameter or a `let`, reads the namespace whole and fails.

The fix names the replacement for each kind of effect:

| The effect | Replacement |
| --- | --- |
| Reads data | A Server Component that passes the data down as props, or `useSWR` or `useSWRInfinite` from `src/lib/swr.ts` when it must load in the browser |
| Derives state from props or state | Compute it in render |
| Responds to an event | The event handler |
| Resets state when a prop changes | A `key` |
| Subscribes to an external store | `useSyncExternalStore` |
| Measures or focuses the DOM | A ref callback |
| Runs a timer | `useTimeout`, `useInterval` or `useAnimationFrame` from `src/lib/timer.ts` |
| Copies the latest props into a ref | `useEffectEvent`, which `banned` allows |

```json
{
  "effect-wrappers": [
    { "file": "apps/web/src/features/map/map-binding.tsx", "reason": "Binds props to the map instance, which renders no element." }
  ]
}
```

The timer hooks ship in the package. Copy them into each React app that runs a timer, then delete the hooks the app does not use:

```sh
cp node_modules/@mapringg/standard/templates/timer.ts apps/web/src/lib/timer.ts
```

`useTimeout(run, delay)` runs `run` once, `delay` milliseconds after mount, and `useInterval(run, delay)` runs it every `delay` milliseconds. A `null` delay waits, and a new delay starts the timer again. `useAnimationFrame(run, running)` runs `run` with the frame time once a frame while `running` is true. Each hook calls the latest `run` without restarting, keeps one timer under StrictMode's double mount, and stops on unmount. To start a timeout again when a value changes, such as a toast's message, give the component a `key`. The file passes oxfmt with the shared config and oxlint with the shared config and the `react` plugin.

Every repository also bans the swr template's `SWRTestCache`, and its former names `ServerDataTestCache` and `SwrScope`, from any module a file imports it from. Only the files that never ship may import it: `*.test.*`, `*.spec.*` and `*.stories.*` files and anything under a `test/`, `tests/`, `__tests__/`, `fixtures/`, `fixture/` or `__fixtures__/` folder. Its own cache hides the app's global cache, and swr 2.5.1 crashes a hook that renders in a hidden `<Activity>` after that cache's provider unmounts. Its fix says to fetch in a Server Component, or to call `useSWR` from `src/lib/swr.ts` on the global cache when the data must load in the client.

| Rule | Fails when |
| --- | --- |
| `import` | A file imports, re-exports, `import()`s or `require()`s the module by a literal name. With `#name`, a file imports that export or reads it through a named, default or namespace binding, an `import()` or `require()` result, a TypeScript `import x = require("m")`, `import x = M` or `import x = M.name` alias, or a JSX tag, so `@base-ui/react#Dialog` matches `<BaseUI.Dialog>`. Static members after the export extend the path, a constant computed key included, and a path matches every longer one, so `vitest#vi.mock` matches `v.mock()` after `import { vi as v } from "vitest"` and `const { mock } = vi`, and `react#useMemo` matches `React.useMemo.call()`. `zod` does not match `zod/mini`, and a type-only import never matches. |
| `global` | A file reads the dotted path, or a path below it, from the global a local name does not shadow. The read may go through `globalThis`, `window`, `self` or `global`, a destructuring, a computed key that is a constant, such as a literal or a `const` that holds a string, or, for `process`, an import of `node:process`. `import.meta.env` counts as a root. A `const` or `let` that a static path initializes carries it, even above its declaration, so `const p = process; p.env` and `const { parse } = JSON` match. A key only runtime knows reads the path before it, so `process.env[name]` matches `process.env`. |
| `property` | A file reads the property on any object by a static key or a destructuring, such as `toLocaleDateString`. |
| oxlint | A tracked `.oxlintrc.json`, `*.oxlintrc.json` or `oxlint.config.*` sets `no-restricted-imports`, `no-restricted-properties` or `no-restricted-globals` anywhere, `"off"` included. |
| Parse | A tracked source does not parse. |

Each file and API is one finding, such as `src/a.ts process.env`, with every line in its fix. `banned` replaces the plugin rules `no-process-env`, `no-bare-json-parse`, `no-module-mocking` and `no-manual-memo` under `packages/oxlint-plugin-*/rules/`, with their tests. To migrate, turn each oxlint `no-restricted-*` entry and each plugin rule's allowlist into one entry, then delete the rule from every oxlint config:

```json
{
  "banned": [
    { "global": "process.env", "files": ["apps/api/**"], "except": ["apps/api/src/env.ts"], "fix": "Use the helpers in src/env.ts." },
    { "property": ["toLocaleDateString", "toLocaleTimeString"], "except": ["apps/*/src/format.ts"], "fix": "Use the helpers in src/format.ts." },
    { "import": ["zod", "zod/v4"], "files": ["apps/web/**"], "fix": "Import zod/mini in apps/web." },
    { "import": ["react#useMemo", "react#useCallback", "react#memo"], "files": ["apps/web/**"], "fix": "React Compiler already memoizes this, so remove it." }
  ]
}
```

The bans on `Reflect.apply` and `Reflect.get` live in the shared oxlint config, so the editor shows them. oxlint does not merge rule options: a config that sets `no-restricted-properties` replaces the shared list for its files, and an override that turns it `"off"` drops it. So each repository's own bans live in `banned`, and `banned` fails any oxlint config that sets one of these rules.

A tree check that the table marks baseline-free keeps no baseline: a baseline file allows nothing, and `--init`, `--write` and `--prune` refuse. A repository with findings keeps the check in `pending` until it finds none.

To adopt `tests` or `pr-tests`, add it to `pending` in the pull request that bumps the pin to 0.10.0, fix what `pnpm exec standard check tests` prints, then remove `tests` from `pending`. Remove `pr-tests` once the team is ready for every pull request that adds logic to carry a test.

`react` holds React state and data fetching to one shape. It has no settings, and it does not apply when no tracked `package.json` declares `react`. An owner is the nearest named function around a call whose name is PascalCase or starts with `use` and a capital, or an anonymous `export default` function. A name comes from the declaration, or from the variable or property that holds the function, through wrapping calls such as `memo(...)`. Hooks count as owners, so moving two `useState` calls into `useFoo` still fails. A call outside an owner counts for no rule, since React's rules of hooks already forbid it. `React.useState` through a default or namespace import, and a local that takes either, such as `const { useState } = React`, count the same as `useState`.

| Rule | Fails when | Fix |
| --- | --- | --- |
| `react/single-use-state` | An owner calls `useState` a second time. Each call after the first is one finding. A single `useState` that holds one value, an object included, passes. | Hold the owner's state in one `useReducer`. |
| `react/no-flag-state` | A `useState` call's first binding is `loading`, `isLoading`, `error` or `isError`. | Model the status in a `useReducer` state union, such as `{ status: "loading" } \| { status: "done", data }`. |
| `react/reducer-status-union` | A `useReducer` state is not a union of two or more members that each have a different string literal `status`, such as `{ status: "idle" \| "done"; data?: Item[] }` or two members with `status: "ready"`. The check reads the state type with the TypeScript the file resolves, through the call's return type, so any binding of the state works. | Make the state a union with one member per status, such as `{ status: "idle" } \| { status: "done", items: Item[] }`. |
| `react/no-direct-swr` | A file imports `swr`, `swr/infinite` or `swr/immutable`, other than `<app>/src/lib/swr.ts` of a React app. A React app is a folder whose tracked `package.json` declares `react` and `next` or `vite`, so a library such as a UI package is not one. A type-only import passes. | Import `useSWR` or `useSWRInfinite` from `src/lib/swr.ts`, copied from the package, which turns off focus and reconnect revalidation. |
| Parse | A tracked source does not parse. | Fix the syntax. |

`react/reducer-status-union` fails closed: a state it cannot read fails under the same key as a wrong one, and the fix names the cause.

| Cause | Fix |
| --- | --- |
| No `typescript` package resolves from the file's folder. | Add `typescript` to that package's devDependencies. |
| No tsconfig covers the file. TypeScript 7 picks the project an editor would, and older TypeScript reads the nearest `tsconfig.json`. | Add the file to that tsconfig's `include`, or add a tsconfig. |
| TypeScript parses the file without that call. | Fix the syntax errors. |
| The call has no return type TypeScript can resolve. | Run the typecheck and fix what it reports at the call, such as missing types for `react`. |
| The state is `any` or `unknown`. | Give the reducer's state a concrete union type. |
| The state is a type parameter, as in a generic hook. | Call `useReducer` where the state type is concrete. |
| TypeScript throws. | Run the typecheck and fix what it reports. |

Each finding names the file, the owner and the API, such as `src/form.tsx Form useState`, with no line number, and a later owner of the same name in the file is `Form 2`. Its fix lists the lines. `react` keeps a baseline, one group per rule, so `standard check react --init` records today's findings and the check fails only new ones. The wrapper ships in the package. Copy it into each React app and import its hooks instead of `swr`:

```sh
cp node_modules/@mapringg/standard/templates/swr.ts apps/web/src/lib/swr.ts
```

Then delete the exports the app does not use, so knip needs no ignore for the file. The file passes oxfmt with the shared config and oxlint with the shared config and the `react` plugin, so it needs no format ignore or lint override.

`useSWR` and `useSWRInfinite` take the arguments of swr's hooks and return what they return, with `data`, `error`, `isLoading`, `isValidating` and `mutate`, and `size` and `setSize` for pages. The wrapper only changes two defaults. `revalidateOnFocus` and `revalidateOnReconnect` are off, and a hook that passes either one as `true` turns it back on. An `SWRConfig` value for them does not reach the hook, so pass them on the hook. To use another swr export, such as `useSWRConfig`, re-export it from the same file. `SWRTestCache` isolates the SWR cache of each test.

`client-data` keeps data loading on the server. A Server Component reads the data and passes it down as props, and a write goes through a Server Action that refreshes the cache with `revalidatePath` or `revalidateTag`. A file that loads data in the browser is the exception, and `client-data` lists it with its reason. The check does not apply when no tracked `package.json` declares `react`. Tests, stories and fixtures are exempt: `*.test.*`, `*.spec.*` and `*.stories.*` files, and anything under a `test/`, `tests/`, `__tests__/`, `fixture/`, `fixtures/` or `__fixtures__/` folder.

| Rule | Fails when | Fix |
| --- | --- | --- |
| `client-data/listed` | A file that `client-data` does not list uses `useSWR` from its app's `src/lib/swr.ts`, through a named, namespace or aliased import, a re-export or a local that holds it. The template's former names `useServerData` and `useServerSeeded` count too, and so do `useSWR` imported from `swr` itself and the hook of `swr/immutable`. The check resolves each import to its file, so a different hook that is also named `useSWR` passes. `useSWRInfinite` needs no entry. | Read the data in a Server Component, and write through a Server Action that refreshes the cache. List the file only when the browser must load the data. |
| `client-data/no-client-fetch` | A file whose directive prologue holds `"use client"`, and that `client-data` does not list, reads the global `fetch` or `XMLHttpRequest`, also through `window` or `globalThis`, a destructured or aliased local, or passed as a value, or imports a value from `ky` or `axios`. It also fails when that file imports, statically or with `import()`, a module that an `api-modules` glob matches, or a module without a directive that uses one of these transports or imports one of these modules at any depth, such as a `*.browser.ts` wrapper. The walk stops at a `"use server"` file, whose Server Actions a client may call, at a `"use client"` file, which the check reads on its own, and at a listed file. Imports resolve as `boundaries` resolves them, tsconfig `paths` included. A type-only import and a local named `fetch` pass. | Pass the data down as props from a Server Component, and send writes through a Server Action. |
| `client-data/config` | A `client-data` entry names a file that git does not track or an app folder that holds no tracked file, or `api-modules` is empty while the repository has a Next app. | Remove or fix the entry, and list the app's API modules in `api-modules`. |

Each entry in `client-data` gives one reason:

| Reason | When |
| --- | --- |
| `pages` | The user pages through the data in the browser. |
| `live` | The data changes without navigation: polling, a live status, search as you type. |
| `client-state` | The request depends on client-only state that does not belong in the URL. |
| `unreachable` | The Next server cannot reach the data, such as a session whose cookie lives on another host. |

```json
{
  "api-modules": ["apps/web/src/api/**"],
  "client-data": [
    { "file": "apps/web/src/search/results.tsx", "reason": "live" },
    { "app": "apps/admin", "reason": "unreachable" }
  ]
}
```

Load data on the server this way:

1. A page or layout never awaits data at its top. It starts each request early, in parallel, without `await`.
2. A Server Component that needs data is a small async component. It awaits its own data, and its parent renders it inside `<Suspense fallback>` where the data shows.
3. A Client Component that needs data takes the unawaited promise as a prop from the server and reads it with React's `use()` inside `<Suspense>`. The promise must come from the server or a cached function. A promise created in a client render is new on every render, so the component suspends forever.
4. Each `<Suspense>` boundary sits inside an error boundary, such as the segment's `error.tsx`.
5. Under Next 16 `cacheComponents`, uncached data outside `<Suspense>` already fails the build.

```tsx
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const orders = params.then(({ id }) => getOrders(id));
  return (
    <Suspense fallback={<OrdersSkeleton />}>
      <Orders orders={orders} />
    </Suspense>
  );
}
```

An entry names one `file` by its exact path, or a whole `app` folder. Only an app with no Server Components, such as a Vite app, goes in whole, and its reason must be `unreachable`. Any other reason, or a glob, fails every command.

The check cannot verify these, so review must:

- A listed reason is true. The reviewer reads the entry and judges it.
- A `use cache` function keys per-user data by the user. Review requires a test in which two users call it and neither sees the other's data.
- Two independent requests run one after the other, such as two `await`s in one async component where neither needs the other. Review asks to start both before awaiting either.

A module that imports an API module counts as one, so a client file that imports any export from it fails, even one that loads nothing. Import the other export from its own file.

`client-data` keeps a baseline, one group per rule. To adopt it, add `client-data` to `pending` in the pull request that bumps the pin to 0.14.13. That bump moves `react/no-client-fetch` out of `react`, so the run rewrites `.standard/baselines/react.json` without those entries and reports each as moved to `client-data`; commit it. In a later pull request, set `api-modules`, list the files that must load data in the browser, remove `client-data` from `pending` and run `standard check client-data --init`. `baseline-growth` then keeps the baseline from growing. As each area moves to the server its entries leave the baseline, and the run deletes the file once the last one goes.

`route-await` enforces the first step above. In each folder whose tracked `package.json` declares `next`, the default export of an `app/**/page.*` or `app/**/layout.*` file may await only its `params` and `searchParams` props. Next 16 passes both as promises, and they only say which route rendered. The check follows them through destructuring and locals, such as `const { id } = await params`, `await props.params` and `const { params: route } = props`. Any other `await` in the component's own body is one finding, keyed by the file, such as `await getUser()` or `await cookies()`. An `await` inside a nested function, in another export such as `generateMetadata`, or in a test passes. A default export that wraps the component in a call, such as `export default withAuth(Page)`, is not read. `route-await` keeps a baseline. Add it to `pending` in the pin bump to 0.14.14, then start the baseline with `standard check route-await --init` in the pull request that removes it.

`use-promise` enforces the third step. In a `"use client"` file, each call of React's `use`, through a named, aliased or namespace import, must read one of these:

- a prop of an exported or default-exported component, also one that `memo` or `forwardRef` wraps, or a parameter of an exported `use…` hook, or a local destructured from one. The file's own calls and elements that pass it are still checked
- the item an inline `.map` or `.flatMap` callback takes from a list that is one of these
- a parameter of a function the file does not export, when each of the file's own calls and elements passes one of these. A call or element that passes a promise it creates is a finding on its line. A function that the file passes around as a value, or never calls, is untraced, and so is an exported lowercase function that is not a hook. A parameter's default must also be one of these
- the result of a function from a module that `cached-modules` lists, or from a file that re-exports one
- a value made once at module level, in the same file or in the module it is imported from, such as a context that `createContext` makes or `const user = getUser("me")`. In the same file, a module-level `let` that any assignment sets again, in render or in another function, is untraced
- the result of a top-level function in the same file that returns only a promise it reuses from a module-level variable: its first statement returns the variable when set (`if (load) return load;`), or it sets the variable only with `??=` or `||=`. A function that sets the variable on each call, such as `load = getUser(id); return load`, fails. So does one whose variable another assignment anywhere in the file can set: a `reset()` or setter function, a store in render, or a callback such as `.finally(() => { load = undefined; })` that clears it and makes the next render fetch again. The guarded store must be the only assignment to the variable, and a `??=` or `||=` variable may be assigned only in that function. One clear is allowed so a failed load can retry. The guarded function keeps the promise in a `const`, stores that `const` in the variable, and attaches a rejection handler to it. The handler is the second argument of `next.then(onFulfilled, onRejected)` or the callback of `next.catch(...)`. It clears the variable to `undefined` or `null` only while it still holds that promise: `if (load === next) load = undefined;`. Without the identity check, a late rejection could clear a newer promise, so it fails, as does a clear in `.finally`, in the fulfillment handler, or in a handler chained into the stored value such as `load = getUser(id).catch(...)`

The check follows locals back to the expression that set them. A call or `new` that is not one of those is a promise the render creates, and it fails. A value that the check cannot trace also fails, such as an import from a module the check cannot resolve or a value that a barrel re-exports. It fails closed because a promise made during render suspends forever, and the fix says how to make the origin readable. Server files, tests, stories and fixtures pass.

Known limits:

- The check reads only files with `"use client"`. A file without the directive that only client files import still runs on the client, but the check does not read it, so `use(fetchUser(id))` there passes.
- The check trusts the props of an exported component or hook. A client parent in another file that creates the promise and passes it as a prop is not caught.
- The file's own calls of an exported component or hook are traced when they call it by name, through JSX or through an alias such as `const read = useRead`. `createElement(Child, { p: fetchUser(id) })` and `ids.map(fetchUser).map(Row)` pass it as a value, so a promise created there passes.
- A local `let` is read from its declaration only. After `let q = p; q = fetchUser(id);`, `use(q)` passes.
- A guarded function that stores a local in its module variable is not checked for changing that local afterwards. `let next = fetchUser(); load = next; next = fetchUser(); return next;` passes.

```json
{ "cached-modules": ["apps/web/src/lib/cached/**"] }
```

`use-promise` keeps a baseline. Add it to `pending` in the pin bump to 0.14.15, then start the baseline with `standard check use-promise --init` in the pull request that removes it.

`suspense-errors` enforces the fourth step. A `<Suspense>` in a file under a Next app's `app` or `src/app` folder needs an error boundary above it. So does a `loading.*` file there, since Next wraps its segment in a `<Suspense>` with it as the fallback. Any of these counts:

- an `error.*` file in the file's folder or a parent folder, up to the `app` folder
- a `global-error.*` file in the `app` folder
- a component around the `<Suspense>` in the same file that `error-boundaries` lists, or that `catchError` from `next/error` makes in that file, such as `const Catch = catchError(Fallback)`

A segment's `error.*` does not catch errors in that segment's own layout or template. For a `<Suspense>` in a `layout.*` or `template.*`, the check therefore starts at the parent folder, and for the root layout only `global-error.*` or a boundary in the file counts. A segment's `error.*` does catch its own `loading.*`. The check finds `Suspense` through a named, aliased, namespace or default import of `react`. Each `<Suspense>` is one finding, and the fix lists every line, with the column where a line holds more than one. A `catchError` boundary made in another file counts once `error-boundaries` lists its export. A boundary that a parent layout renders around `{children}` does not count, so add an `error.tsx` to that segment instead.

```json
{ "error-boundaries": ["react-error-boundary#ErrorBoundary", "apps/web/src/components/error-boundary.tsx#ErrorBoundary"] }
```

An entry is a package or a repository file, then `#` and the export. The check resolves a repository file through the import, tsconfig `paths` included. The check reads only files under the `app` folder, because a file's folder there is its route segment. A shared component outside the `app` folder can render in any segment, so review checks its `<Suspense>`. `suspense-errors` keeps a baseline. Add it to `pending` in the pin bump to 0.14.16, then start the baseline with `standard check suspense-errors --init` in the pull request that removes it.

`cache-components` requires the fifth step. Each folder whose tracked `package.json` declares `next` needs a `next.config.*` that exports `cacheComponents: true` at its top level. The check reads the AST, not the text. It reads the file Next 16 loads, the first of `next.config.js`, `next.config.mjs`, `next.config.ts` and `next.config.mts`. It follows `export default` and `module.exports`, local names, `satisfies` and `as`, spreads in order, plugin calls such as `withSentryConfig(withNextIntl(config), options)`, and a config function, as an arrow, a function expression or a function declaration, through the last `return` in its body. A plugin call counts through the argument that sets `cacheComponents`, wherever it sits, so the check assumes that a plugin keeps the keys of the config it wraps. When no argument sets it and one cannot be read, the check says so. A package that declares `next` only in `peerDependencies` or `devDependencies` and has no config is a library, so the check skips it. A value such as `process.env.X === "1"`, a config that a call builds with no readable object, or `experimental.cacheComponents` (Next 15's place) fails. A config the check cannot read fails with what stopped it.

A config flag is on or off, so `cache-components` keeps no baseline. To roll it out, add it to `pending` in the pin bump to 0.14.17. Turning the flag on fails the build wherever an uncached read sits outside `<Suspense>`, and `<Activity>` keeps hidden routes mounted. So switch each app in its own pull requests, split by area, and remove `cache-components` from `pending` in the pull request that sets the flag.

`no-comments` fails a comment in source. A name, a test name or a type carries the why. A decision that an agent would otherwise undo goes under a heading in a doc, and a comment points at the doc. The check reads every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` and `.astro` file that git tracks outside `node_modules`, `.d.ts` files included. It reads an `.astro` component's frontmatter and scripts as `banned` does, and the code in its markup expressions and attribute expressions through the Astro compiler. A comment in any of them is judged like a comment in a `.ts` file. An HTML comment in the markup always fails, since it ships to every visitor; that includes conditional and bogus comments such as `<?x?>`. Markup text, `is:raw` content and a decoded quoted `set:html` value reach the browser as written. So the check parses each with the parse5 HTML parser inside the elements around it, as a browser without JavaScript does, and fails each comment the parser finds. So `<![CDATA[ ]]>` in SVG or MathML is text and passes, a comment in an SVG `<title>` or `<style>` fails, and `<!--` in an HTML `<title>`, `<textarea>` or `<style>` is text and passes. Text in a script a browser does not run, such as `application/ld+json`, and in an attribute string is not markup, so a comment-like run of characters there passes. It has no settings. These comments pass:

| Comment | Passes when |
| --- | --- |
| `eslint-disable` or `oxlint-disable`, and their `-line` and `-next-line` forms | A reason follows ` -- ` after the rule names. An `-enable` comment always passes. |
| `@ts-expect-error` | A reason follows it. `@ts-ignore` and `@ts-nocheck` always fail. |
| `SAFETY:` | It sits directly above a type assertion other than `as const`, or above a statement, property, `return` or `throw` that holds one. Line comments on the lines right after it continue it, up to the next directive. Its last line ends with `.`, `?` or `!`. |
| `See: <path>` alone in the comment | The path, from the repository root, is a tracked `docs/*.md` or `apps/*/docs/*.md` file. An optional `#<anchor>` names one of its headings, as GitHub slugs it. |
| A license tag | It sits above the file's code and every line of it is `SPDX-License-Identifier:` or `@license` followed by a license expression alone, such as `MIT` or `Apache-2.0 OR MIT`, that parses as SPDX and names only SPDX-listed licenses and exceptions; a `LicenseRef-` or `DocumentRef-` fails, since its name could say anything. A comment that mentions a copyright, `©`, SPDX or `@license`, or that mentions a license in a header above the file's code that holds such a notice besides a passing license tag, gets a fix that says this. A copyright line or a license notice is not allowed in the repository's own code; third-party code that carries one is vendored, and `.gitattributes` marks its path `linguist-vendored`. |

A hashbang and a directive such as `"use client"` are not comments. A generated file is skipped: `next-env.d.ts`, and any file that `.gitattributes` marks `linguist-generated` or `linguist-vendored`, such as `src/generated/** linguist-generated`, as `git check-attr` reads it. A file's own comments never mark it generated, so a header such as `// @generated` or `// Code generated by protoc. DO NOT EDIT.` fails like any other comment; mark the path in `.gitattributes` instead, which also collapses the file in GitHub diffs. JSDoc fails like any other comment, and so does a `/// <reference>` outside a skipped file; put the types in the tsconfig `types` list. A file that does not parse fails. Each file and kind of comment is one finding, such as `src/a.ts comment`, with every line in its fix. `no-comments` keeps no baseline. It replaces the plugin rule `no-comments` under `packages/oxlint-plugin-*/rules/` and its test; remove the rule from every oxlint config in the same pull request.

## Shared configs

The package ships one oxlint config, one oxfmt config and one tsconfig. The lint and format configs are tested with oxlint 1.92 and 1.93 and oxfmt 0.77 and 0.78. Each holds only the settings every adopting repository already agreed on, so a repository adds its own plugins, rules, ignores and Tailwind stylesheets on top.

| Export | File | Holds |
| --- | --- | --- |
| `@mapringg/standard/oxlint-config` | `config/oxlint.json` | The `eslint`, `typescript`, `unicorn`, `oxc`, `import` and `promise` plugins, `correctness` as errors, type-aware linting with type checks, unused disable directives as errors, `import/no-cycle` to depth 3, kebab-case file names, no `any`, and bans on `Reflect.apply` and `Reflect.get`. |
| `@mapringg/standard/oxfmt` | `config/oxfmt.json` | Type imports first, then grouped value imports; sorted `package.json` scripts; `.claude/**` ignored. |
| `@mapringg/standard/tsconfig` | `config/tsconfig.json` | `strict` and each flag in its family, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` and `isolatedModules`; unreachable code and unused labels as errors. |

`.oxlintrc.json` takes a path in `extends`, relative to the file that extends, and refuses a package name. A child's `plugins` adds to the shared list. A child that sets `no-restricted-properties` replaces the shared bans, so `banned` fails it:

```json
{
  "extends": ["../../node_modules/@mapringg/standard/config/oxlint.json"],
  "plugins": ["react", "nextjs", "jsx-a11y", "react-perf"]
}
```

`oxlint.config.ts` can import the export instead:

```ts
import { defineConfig } from "oxlint";
import standard from "@mapringg/standard/oxlint-config" with { type: "json" };

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

A `tsconfig.json` names the tsconfig export in `extends`. Environment options such as `module`, `target`, `jsx`, `lib` and `paths` stay in the app's own file:

```json
{ "extends": "@mapringg/standard/tsconfig", "compilerOptions": { "module": "nodenext", "target": "es2024" } }
```

A framework preset goes first, so the base comes last and wins:

```json
{ "extends": ["astro/tsconfigs/strict", "@mapringg/standard/tsconfig"] }
```

To adopt it, add `"typecheck"` to `pending`, fix what `pnpm exec standard check typecheck` prints, then remove it from `pending`.

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

api: 17 of 17 pass
web: 17 of 18 pass
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

`hooks` lists shell lines that run from the repository root, in order, and stop at the first failure. `pending` lists checks the repository has not adopted yet. A pending check does not run, and the list only shrinks. `pr.ticket-prefix` is the tracker key for the `Ticket:` line; leave it out when the repository has no tickets. `pr.screenshots` turns on `pr-screenshot`: `when` lists the globs of files that need a screenshot, and `uploader` is the repository path of the script that uploads one. `boundaries` holds the `modules` and `forbid` rules of the `boundaries` check. `client-data` and `api-modules` configure the `client-data` check, `cached-modules` configures `use-promise`, and `error-boundaries` configures `suspense-errors`.

### Fixed-path oxlint plugin

Oxlint 1.93.0 loads `@mapringg/standard/oxlint` through `jsPlugins`. The JSON config export is now `@mapringg/standard/oxlint-config`; its direct `config/oxlint.json` path still works. Enable the plugin rules in your oxlint config:

```json
{
  "jsPlugins": ["@mapringg/standard/oxlint"],
  "rules": {
    "standard/redis": "error", "standard/ai": "error",
    "standard/ui": "error", "standard/timer": "error", "standard/swr": "error",
    "standard/env": "error", "standard/json": "error",
    "standard/log": "error", "standard/format": "error",
    "standard/effect": "error", "standard/effect-cleanup": "error",
    "standard/client-data": "error", "standard/names": "error",
    "standard/action-schema": "error", "standard/cache-tag": "error",
    "standard/ai-render": "error"
  }
}
```

Each package owns environment reads in `src/env.ts`, JSON parsing in `src/lib/json.ts`, logging in `src/lib/log.ts`, date formatting in `src/lib/format.ts`, Redis imports in `src/lib/redis.ts`, AI SDK imports in `src/lib/ai.ts`, SWR imports in `src/lib/swr.ts`, and primitive UI imports under `src/components/ui/`. Owners may use `.server.ts` and `.browser.ts` variants. Tests, fixtures, stories, scripts, evals and config files are excluded. Diagnostics name the owner's exported helpers when the owner exists. The CLI `banned` check remains available during migration.

`standard explain` lists every `standard/<rule>` beside the checks, and `standard explain standard/<rule>` prints one, since `allow` takes those ids.

### Roles in file names

A file that many files share a role with names it as `<name>.<role>-<reason>.<ext>`, before `.browser`, `.server` and `.test`, such as `session-sync.data-unreachable.effect-route.tsx`.

| Rule | Only these files may |
| --- | --- |
| `standard/effect` | call `useEffect`, `useLayoutEffect` or `useInsertionEffect`, imported, read from the namespace or destructured from it: `.effect-sync` keeps an outside system in step, `.effect-route` reacts to the URL Next exposes only through hooks, `.effect-subscribe` adds a listener. Tests and `src/lib/timer.ts` are exempt. No file re-exports an effect hook. |
| `standard/effect-cleanup` | pass: every effect in an `.effect-subscribe` file is an inline function whose last statement is a `return`, and every `return` hands back an inline function or a `const` the effect binds to one. |
| `standard/client-data` | load data in the browser: `.data-pages`, `.data-live`, `.data-client-state` and `.data-unreachable`. Loading means a `use*` hook of `src/lib/swr.ts` or swr, or, in code that ships to the browser, `fetch`, `XMLHttpRequest`, `EventSource` or `WebSocket`, bare or on `window`, `self` or `globalThis`, `ky`, `axios` or an import of `src/lib/api/`. The `src/` of a Vite React app, one with `index.html` or `vite.config.*` beside its `package.json`, is unreachable as a whole. |
| `standard/names` | carry a role segment: the reason is one of the words above, and the segment sits before `.browser`, `.server` and `.test`, and `.cache` appears only as `<name>.cache.ts`. |

`<name>.cache.ts` names a module whose functions return a cached promise that `use` may read. The CLI `banned` and `client-data` checks accept the same names. During adoption the plugin and the CLI still read the legacy `effect-wrappers` and `client-data` lists, with a deprecation notice, but only from a legacy config the CLI accepts; they are not in the new schema. `standard migrate names --write` renames the files they list.

`standard migrate names` prints the plan and changes nothing. With `--write` it renames each listed file with `git mv`, adding `data-<reason>` from its `client-data` reason and `effect-<reason>` from words in its `effect-wrappers` reason. Colocated tests, `<name>.*.test.*` and the like, are renamed with their file. It rewrites every relative and tsconfig `paths` specifier that resolves to a renamed file, in imports, `export from`, `import()`, `require()` and the `vi.mock` family, in tracked and untracked sources. It updates the renamed paths in tracked Markdown, including a shorter tail such as a bare file name when it names only that file, `.standard/baselines/` and the rest of `.standard/config.json`, and drops the migrated entries from the lists. Before it changes anything it refuses the whole run, and exits 1, when a source is untracked, a destination exists, or a specifier reaches a renamed file but cannot follow it, such as an exact tsconfig alias or a computed `import()`. An index file keeps its name, and an effect reason that names no role or more than one is printed for a person to pick; pass the pick as `--effect <file>=<sync|route|subscribe>`, or rewrite the effect. A second run changes nothing.

### Server-first rules

| Rule | What it requires |
| --- | --- |
| `standard/action-schema` | Every export of a `"use server"` file is an inline function, and every Server Action, such an export or a function with its own `"use server"`, takes plain parameters and parses each one before any other statement. Only a throwing parse counts: `schema.parse(raw)` or `parseAsync` for zod and zod/mini, or `parse(schema, raw)` for zod/mini and valibot, where the schema is an imported binding or a module-level `const` built from the validator. `schema.parse(Object.fromEntries(formData))` parses a form. A file that imports no validator fails each action that takes an argument. |
| `standard/cache-tag` | Every `use cache` scope, a function with the directive or an export of a file with it, is an inline function that calls `cacheTag` from `next/cache` with at least one tag as a top-level statement. A file-level `use cache` file exports only inline functions. |
| `standard/ai-render` | In a package that depends on `next`, only a `"use server"` file, a `route.*` handler and `src/lib/ai.ts` with its `.server` and `.browser` variants import `src/lib/ai`. Every other file fails, so a Server Component, a `use cache` function and any wrapper they could reach never generate. Outside a Next app there is no render, so the rule skips it; `standard/ai` still keeps the SDK and `ai` behind `src/lib/ai*`. |

### Module entries

Every folder under an app's `src/`, `src/features/` and `src/components/` is a module, so shared components are imported by group, such as `@/components/chart`. `src/lib` and `src/components/ui` stay open. A module has up to three entries: `index`, `index.server` and `routes`. `index.server` is the module's server-only surface, and route files may import it even though they may not import a feature's other `*.server.*` files.

| Rule | What it requires |
| --- | --- |
| `standard/server-entry` | Code that ships to the browser, a `"use client"` or `.browser` file or anything one reaches, imports no `*.server.*` file. Each import, re-export, `require()` and static `import()` is resolved through relative paths, tsconfig paths and package.json `imports`, so an alias or a re-export chain reaches the same verdict. |
| `standard/index-exports` | A plain `index` imports and re-exports no `*.server.*` file and no API module, the derived `**/src/lib/api/**` or a legacy `api-modules` list. Those go in `index.server`. This is the early per-file guard; `standard/server-entry` follows chains. |
| `standard/client-feature-import` | Code in `src/features/<a>` that ships to the browser, found the same way, imports nothing from another `src/features/<b>`, through its index, a deep path, a re-export or `import()`. A feature's index re-exports its widgets, so one shared constant pulled that way bundles the whole feature into every page. Features meet only in `src/app` routes; the shared pieces move to `src/lib` or `src/components/<group>`, and the message names them. Type-only imports pass. |

The plugin builds the browser graph from the files on disk. In an editor it checks for changed files at most once a second and rebuilds then, so an unsaved edit counts only after it is saved, and a result can lag for up to a second. `standard check` and CI runs of oxlint start fresh and are authoritative.

### Configuration in 0.16.0

An empty `.standard/config.json` enables every check. The schema has four keys: `$schema`, `ticket`, `skip` and `allow`. `skip` is temporary rollout debt and may only shrink. `allow` is the only file exception, for CLI checks and `standard/<rule>` plugin rules alike.

```json
{
  "$schema": "../node_modules/@mapringg/standard/schema.json",
  "ticket": "ABC",
  "skip": ["cache-components"],
  "allow": { "standard/log": ["src/legacy.ts"] }
}
```

Every allow glob must change a finding; unmatched, redundant and skipped-rule exceptions fail. Keep plugin rules at error in oxlint; the config guard rejects disabled or warning-level standard rules there. The guard skips commit-message runs. Checks keep their built-in advisory behavior. Malformed ticket lines warn during checks and block merge.

Earlier repository-specific keys, including `pr.ticket-prefix` and `pending`, still parse with a deprecation notice during adoption. Mixing formats fails. Fixed paths, module entries, Next layering, API paths, cached-module names, hook commands and screenshot requirements are derived. Initialize doc line budgets with `standard check docs --init`, and lower them with `standard check docs --write`.

Zod Mini is required in browser code: the `src` folder of a Vite React app with index.html or a vite config beside its manifest, and the value-import graph from `use client` or `.browser.*` modules, including shared code. Server-only code is exempt. Boundaries skip tests, fixtures, stories, scripts, evals and config importers. Mocking and comment checks still read those sources. Fixed `src/lib/*` owners remain directly importable.

## Contributing

Run `pnpm install --frozen-lockfile`, then the three gates:

```sh
pnpm test
pnpm typecheck
./node_modules/.bin/oxlint
```

`pnpm typecheck` runs `tsc -p tsconfig.json`: strict `checkJs` over `bin` and `src` with `types: ["node"]`. TypeScript 7 loads no `@types` packages by default, so a bare `tsc` call over the files misses the Node types and reports errors that the project config doesn't.
