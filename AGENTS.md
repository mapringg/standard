# Working on the standard

- `oxlint.json` is hand-written and stays a few KB. Path logic belongs in plugin rules, not in per-glob overrides.
- Built-in first. Before adding a plugin rule, check `pnpm exec oxlint --rules` and the restriction rules (`no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties`) with per-glob overrides. Write a plugin rule only for what none of them can express, and keep the rule set small.
- Owner bans are data: add a row to `TABLE` in `src/plugin/owners.mjs` with the banned thing, the owner globs (`owner`) or the globs it is banned in (`in`), the app kinds, and a one-sentence `use` message that says what to do instead.
- Every rule message says what to do instead, in one sentence.
- Before switching a category rule off, check it against the template monorepo. Add it to the off-list in README with one reason.
- Plugin rules live in `src/plugin/<rule>.mjs`, one rule per file, registered in `src/plugin/index.mjs`. `paths.mjs` maps a filename to its app, its kind (detected from `src/factory.ts` or `package.json`) and its app-relative path.
- Each plugin rule has one `test/<rule>.test.mjs`. It writes a small repo of valid and invalid files, runs oxlint over it once through `test/lint.mjs` and compares the flagged files. No snapshots.
- This repo follows the standard where it applies: no comments, kebab-case files, no barrels. `pnpm lint` checks that.
- `pnpm test` runs everything in under a second. Keep it that way.
- A release is a tag `vX.Y.Z` on main that adopters pin as `github:mapringg/standard#vX.Y.Z`. Never move or delete tags.
- The repo is public. Name adopters only as repo-a, repo-b and repo-c.
