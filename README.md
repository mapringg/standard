# standard

One repository standard for every project: lint rules, repository checks, and a score that reports what each repository is missing.

## Use

Add the package at a tag and install its hooks when the repository installs:

```json
{
  "scripts": { "prepare": "standard install" },
  "devDependencies": { "@mapringg/standard": "github:mapringg/standard#v0.14.0" }
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
| `baseline-growth` | A pull request does not add a check to `pending` or create or grow a baseline, and `.standard` tracks no symlink. The pull request that removes a check from `pending` may start its baseline. A pin bump may add the checks its new version introduced, and the pull request that first installs the standard may add any. | Fix the new findings instead of recording them. | `pending` | 0.2.0 | yes |
| `wiring` | The repository runs the standard: a CI Check job runs `standard check`, `package.json` pins the package exactly, the install matches the pin, `prepare` runs `standard install`, git tracks `.standard/config.json`, `CLAUDE.md` is `@AGENTS.md` when present, and git tracks no script a check retires unless that check is pending. `standard score`, not this check, reads the installed hooks. | Make the change the probe names, such as deleting a retired script. | `pending` | 0.4.0 | yes |
| `dead-code` | knip finds no unused file, export, type or dependency, and no unlisted dependency. | Delete the unused code or dependency, or add the missing one. | none | 0.8.0 | yes |
| `duplicates` | No two function bodies or conditional expressions of 8 or more AST nodes match once types are dropped and the names they declare are renamed. It reads tracked `.ts` and `.tsx` files, except `.d.ts`, `*.test.*`, `*.spec.*`, `*.stories.*` and `test`, `tests` and `__tests__` folders. | Move the shared logic to the module that owns it and import it everywhere. | none | 0.8.0 | yes |
| `typecheck` | Each TypeScript project loads the shared strict tsconfig and keeps its flags. The root and each project's `package.json` have a real `typecheck` script, `hooks.pre-push` runs `pnpm typecheck`, and the CI Check job runs it. The check reads configs and wiring; it does not type-check source, which the script does. | Add the shared base to `extends`, remove the overriding flag, or add the script, pre-push line or CI step the finding names. | `hooks.pre-push` | 0.9.0 | yes |
| `tests` | The repository's test command exists, runs before a push, and runs in CI where a failure blocks the merge. | Add the test script, the `pnpm test` pre-push line or the CI step the finding names. | `hooks.pre-push` | 0.10.0 | yes |
| `pr-tests` | A pull request that adds logic to a package's source adds or changes a test in that package. | Add or change a test in the package that covers the new logic. | none | 0.10.0 | yes |
| `boundaries` | An import respects the package, module and forbid boundaries the repository draws. | Import through the module's entry or the package's exports, or move the code. | `boundaries` | 0.11.0 | yes |
| `banned` | A file uses no API the repository bans, and no oxlint config bans APIs a second way. | Use what the entry's `fix` names instead. | `banned` | 0.12.0 | yes |
| `react` | A component or hook calls `useState` at most once and never for a `loading`, `isLoading`, `error` or `isError` flag. Each `useReducer` state is a union whose members have different `status` literals. A `"use client"` file does not read `fetch`, and only each Next app's `src/lib/swr.ts` imports swr. | Hold more than one value in a `useReducer` with a status union, fetch on the server, and use the `src/lib/swr.ts` hooks instead of swr. | none | 0.12.0 | no |
| `no-comments` | Source holds no comments except reasoned directives, `SAFETY:` above a type assertion, `See:` pointers to a doc or one of its headings, and license headers. Generated files are skipped. | Move the why into a name, test or type, or into a doc that a `See:` comment points at. | none | 0.13.0 | yes |
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

`duplicates` fails on code that repeats. It parses the `.ts` and `.tsx` files git tracks, except `.d.ts`, `*.test.*`, `*.spec.*`, `*.stories.*` and anything under a `test/`, `tests/` or `__tests__/` folder. It replaces `scripts/check-duplicates.mjs`, its test and `scripts/baselines/duplicates.json`.

| Rule | What it means |
| --- | --- |
| Unit | A function body or a conditional expression with 8 or more AST nodes. |
| Same | Two units match once types are dropped and the names each unit declares are renamed in order. Literals, property names and names from outside the unit must be equal. |
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

`boundaries` fails an import that crosses a boundary the repository draws. It parses the `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` files git tracks and reads, from the syntax tree, the specifier of each import declaration, `export ... from`, `import x = require()`, and `import()` or `require()` of a string or a template without expressions. A `require()` call reads the nearest binding of its callee, so a parameter or a local of the same name shadows it, as in JavaScript. A `const` loader that `createRequire` makes resolves from its anchor when the anchor is a string, `import.meta.url`, `__filename` or `new URL("<literal>", import.meta.url)`. That holds under any name, when `createRequire` is imported from `node:module` or read from a `const` of it. These are not read: an `import()` or `require()` of a computed value; a call inside a `with` block; and a call through a loader with a computed anchor, one declared with `let` or `var` or destructured, or one that a destructured `createRequire` makes. A type-only import counts, because it ties the importer to the file the same way. Run `pnpm install` first, so workspace packages and the compiler resolve.

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

`banned` fails a file that uses an API its repository bans. Each entry in the `banned` list of `.standard/config.json` names the API with exactly one of `import`, `global` or `property`, as a string or a list, and says what to use instead in `fix`. `files` lists the globs it covers, every tracked source when absent, and `except` lists the globs inside them where the API is allowed. A use counts once, for the first entry that covers its file.

| Rule | Fails when |
| --- | --- |
| `import` | A file imports, re-exports, `import()`s or `require()`s the module by a literal name. With `#name`, a file imports that export or reads it through a named, default or namespace binding, an `import()` or `require()` result or a JSX tag, so `@base-ui/react#Dialog` matches `<BaseUI.Dialog>`. `zod` does not match `zod/mini`, and a type-only import never matches. |
| `global` | A file reads the dotted path, or a path below it, from the global a local name does not shadow. The read may go through `globalThis`, `window`, `self` or `global`, a destructuring, a literal computed key or, for `process`, an import of `node:process`. `import.meta.env` counts as a root. A `const` or `let` that a static path initializes carries it, even above its declaration, so `const p = process; p.env` and `const { parse } = JSON` match. |
| `property` | A file reads the property on any object by a static key or a destructuring, such as `toLocaleDateString`. |
| oxlint | A tracked `.oxlintrc.json`, `*.oxlintrc.json` or `oxlint.config.*` sets `no-restricted-imports`, `no-restricted-properties` or `no-restricted-globals` anywhere, `"off"` included. |
| Parse | A source that an entry covers does not parse. |

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

The bans every repository shares, `Reflect.apply`, `Reflect.get` and module mocking through `vi` or `jest`, live in the shared oxlint config, so the editor shows them. oxlint does not merge rule options: a config that sets `no-restricted-properties` replaces the shared list for its files, and an override that turns it `"off"` drops it. So each repository's own bans live in `banned`, and `banned` fails any oxlint config that sets one of these rules.

A tree check that the table marks baseline-free keeps no baseline: a baseline file allows nothing, and `--init`, `--write` and `--prune` refuse. A repository with findings keeps the check in `pending` until it finds none.

To adopt `tests` or `pr-tests`, add it to `pending` in the pull request that bumps the pin to 0.10.0, fix what `pnpm exec standard check tests` prints, then remove `tests` from `pending`. Remove `pr-tests` once the team is ready for every pull request that adds logic to carry a test.

`react` holds React state and data fetching to one shape. It has no settings, and it does not apply when no tracked `package.json` declares `react`. An owner is the nearest named function around a call whose name is PascalCase or starts with `use` and a capital, or an anonymous `export default` function. A name comes from the declaration, or from the variable or property that holds the function, through wrapping calls such as `memo(...)`. Hooks count as owners, so moving two `useState` calls into `useFoo` still fails. A call outside an owner counts for no rule, since React's rules of hooks already forbid it. `React.useState` through a default or namespace import, and a local that takes either, such as `const { useState } = React`, count the same as `useState`.

| Rule | Fails when | Fix |
| --- | --- | --- |
| `react/single-use-state` | An owner calls `useState` a second time. Each call after the first is one finding. A single `useState` that holds one value, an object included, passes. | Hold the owner's state in one `useReducer`. |
| `react/no-flag-state` | A `useState` call's first binding is `loading`, `isLoading`, `error` or `isError`. | Model the status in a `useReducer` state union, such as `{ status: "loading" } \| { status: "done", data }`. |
| `react/reducer-status-union` | A `useReducer` state is not a union of two or more members that each have a different string literal `status`, such as `{ status: "idle" \| "done"; data?: Item[] }` or two members with `status: "ready"`. The check reads the state type with the TypeScript the file resolves, through the call's return type, so any binding of the state works. | Make the state a union with one member per status, such as `{ status: "idle" } \| { status: "done", items: Item[] }`. |
| `react/no-client-fetch` | A file whose directive prologue holds `"use client"` reads the global `fetch`, also through `window` or `globalThis` or passed as a value. A local named `fetch` passes. | Fetch in a server component, or through `useServerSeeded` or `useServerSeededInfinite` from `src/lib/swr.ts` when the data needs pagination or revalidation. |
| `react/no-direct-swr` | A file imports `swr` or `swr/infinite`, other than `<app>/src/lib/swr.ts` of a folder whose tracked `package.json` declares `next`. A type-only import passes. | Use `useServerSeeded` or `useServerSeededInfinite` from `src/lib/swr.ts`. |
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

Each finding names the file, the owner and the API, such as `src/form.tsx Form useState`, with no line number, and a later owner of the same name in the file is `Form 2`. Its fix lists the lines. `react` keeps a baseline, one group per rule, so `standard check react --init` records today's findings and the check fails only new ones. The wrapper ships in the package. Copy it into each Next app and import its hooks instead of `swr`:

```sh
cp node_modules/@mapringg/standard/templates/swr.ts apps/web/src/lib/swr.ts
```

`useServerSeeded` takes the data a server component fetched as `fallbackData`, so the first render has no loading state, and `useServerSeededInfinite` does the same for pages. `SwrScope` gives a test an empty cache in place of `SWRConfig`.

`no-comments` fails a comment in source. A name, a test name or a type carries the why. A decision that an agent would otherwise undo goes under a heading in a doc, and a comment points at the doc. The check reads every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` file that git tracks outside `node_modules`, `.d.ts` files included. It has no settings. These comments pass:

| Comment | Passes when |
| --- | --- |
| `eslint-disable` or `oxlint-disable`, and their `-line` and `-next-line` forms | A reason follows ` -- ` after the rule names. An `-enable` comment always passes. |
| `@ts-expect-error` | A reason follows it. `@ts-ignore` and `@ts-nocheck` always fail. |
| `SAFETY:` | It sits directly above a type assertion other than `as const`, or above a statement, property, `return` or `throw` that holds one. Line comments on the lines right after it continue it, up to the next directive. Its last line ends with `.`, `?` or `!`. |
| `See: <path>` alone in the comment | The path, from the repository root, is a tracked `docs/*.md` or `apps/*/docs/*.md` file. An optional `#<anchor>` names one of its headings, as GitHub slugs it. |
| A license header | It sits above the file's code, and the first comment holds `@license` or `SPDX-License-Identifier:`. |

A hashbang and a directive such as `"use client"` are not comments. A generated file is skipped: `next-env.d.ts`, and any file whose comments above its code hold `@generated`, have a line that starts with `generated by`, `auto-generated` or `this file was generated`, or say both that the code is generated and `do not edit` (or `do not modify`), in any case. A sentence that only mentions generating something, such as `The IDs are generated by the database.`, or only says `Do not edit`, does not count. JSDoc fails like any other comment, and so does a `/// <reference>` outside a generated file; put the types in the tsconfig `types` list. A file that does not parse fails. Each file and kind of comment is one finding, such as `src/a.ts comment`, with every line in its fix. `no-comments` keeps no baseline. It replaces the plugin rule `no-comments` under `packages/oxlint-plugin-*/rules/` and its test; remove the rule from every oxlint config in the same pull request.

## Shared configs

The package ships one oxlint config, one oxfmt config and one tsconfig. The lint and format configs are tested with oxlint 1.92 and 1.93 and oxfmt 0.77 and 0.78. Each holds only the settings every adopting repository already agreed on, so a repository adds its own plugins, rules, ignores and Tailwind stylesheets on top.

| Export | File | Holds |
| --- | --- | --- |
| `@mapringg/standard/oxlint` | `config/oxlint.json` | The `eslint`, `typescript`, `unicorn`, `oxc`, `import` and `promise` plugins, `correctness` as errors, type-aware linting with type checks, unused disable directives as errors, `import/no-cycle` to depth 3, kebab-case file names, no `any`, and bans on `Reflect.apply`, `Reflect.get` and module mocking. |
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
import standard from "@mapringg/standard/oxlint" with { type: "json" };

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

`hooks` lists shell lines that run from the repository root, in order, and stop at the first failure. `pending` lists checks the repository has not adopted yet. A pending check does not run, and the list only shrinks. `pr.ticket-prefix` is the tracker key for the `Ticket:` line; leave it out when the repository has no tickets. `pr.screenshots` turns on `pr-screenshot`: `when` lists the globs of files that need a screenshot, and `uploader` is the repository path of the script that uploads one. `boundaries` holds the `modules` and `forbid` rules of the `boundaries` check.
