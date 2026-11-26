# Standard

## Rules

- Use a built-in oxlint rule before writing a plugin rule.
- An owner ban is a row in the owners table, not a new rule.
- Every rule message says what to do instead, in one sentence.
- Each rule has its own module and its own test file.
- Run `pnpm lint`, `pnpm format:check`, `pnpm knip` and `pnpm test`.

## Operations

- Work lands on main through PRs. There is no develop branch.
- Bump `version` in the PR that changes behavior. After it merges, tag that main commit `vX.Y.Z`.
- Consumers pin a release tag. Never move or delete a tag.
- The repo is public. Name adopters only as repo-a, repo-b and repo-c.

## Sources

- Follow the [test audit skill](.claude/skills/test-audit/SKILL.md) before a migration or broad refactor.
- Use the [standard review skill](.claude/skills/review-standard/SKILL.md) when reviewing a diff for simplifications.
- Use the [PR writing skill](.claude/skills/pr/SKILL.md) when writing a pull request.
- Follow [Capture](.claude/skills/capture/SKILL.md) when preparing pull request evidence.
