# Working on the standard

- Use a built-in oxlint rule before writing a plugin rule.
- Owner bans are rows in `src/plugin/owners.mjs`.
- Every rule message says what to do instead, in one sentence.
- One rule per `src/plugin/<rule>.mjs`, tested in `test/<rule>.test.mjs`.
- Run `pnpm lint`, `pnpm format:check`, `pnpm knip` and `pnpm test`.
- Releases are tags `vX.Y.Z` on main. Never move or delete them.
- The repo is public. Name adopters only as repo-a, repo-b and repo-c.
