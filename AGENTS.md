# Working on the standard

- `oxlint.json` is generated. Edit `scripts/oxlint-config.mjs`, then run `pnpm generate` and `pnpm format`. `test/oxlint-config.test.mjs` fails when the two drift apart.
- Built-in first. Before adding a plugin rule, check `pnpm exec oxlint --rules` and the restriction rules (`no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties`) with per-glob overrides. Write a plugin rule only for what none of them can express, and keep the rule set small.
- Owner exemptions are data: add an entry with `apps`, `exempt` or `only` to `ENTRIES` in `scripts/oxlint-config.mjs`. The generator emits one override per glob with only the rule keys that change.
- Plugin rules live in `src/plugin/<rule>.mjs`, one rule per file, registered in `src/plugin/index.mjs`. `paths.mjs` maps a filename to its app and app-relative path.
- Each plugin rule has one `test/<rule>.test.mjs`. It writes a small repo of valid and invalid files, runs oxlint over it once through `test/lint.mjs` and compares the flagged files. No snapshots.
- This repo follows the standard where it applies: no comments, kebab-case files, no barrels. `pnpm lint` checks that.
- `pnpm test` runs everything in under a second. Keep it that way.
- A release is a tag `vX.Y.Z` on main that adopters pin as `github:mapringg/standard#vX.Y.Z`. Never move or delete tags.
- The repo is public. Name adopters only as repo-a, repo-b and repo-c.
