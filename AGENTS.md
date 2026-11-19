# Standard

## Rules

- Use a built-in oxlint rule before writing a plugin rule.
- An owner ban is a row in the owners table, not a new rule.
- Every rule message says what to do instead, in one sentence.
- Each rule has its own module and its own test file.
- Run `pnpm lint`, `pnpm format:check`, `pnpm knip` and `pnpm test`.

## Operations

- Releases are `vX.Y.Z` tags on main. Never move or delete them.
- The repo is public. Name adopters only as repo-a, repo-b and repo-c.
