# AGENTS.md

## Rules

- Use a built-in Oxlint rule before writing a plugin rule.
- Add owner bans to the owners table.
- Say what to do instead in one sentence in each rule message.
- Give each rule its own module and test file.
- Run `pnpm lint`, `pnpm format:check`, `pnpm knip` and `pnpm test`.
- Land changes on main through a pull request.
- Bump the version when behavior changes and tag the merged commit `vX.Y.Z`.
- Keep release tags immutable.
- Refer to adopters as repo-a, repo-b and repo-c in public.

## Sources

- Follow the [test audit skill](.claude/skills/test-audit/SKILL.md) before a migration or broad refactor.
- Use the [standard review skill](.claude/skills/review-standard/SKILL.md) when reviewing a diff for simplifications.
- Use [PR writing](.claude/skills/pr/SKILL.md) when writing a pull request.
- Follow [Capture](.claude/skills/capture/SKILL.md) when preparing pull request evidence.
- Follow [Adopt Standard](.claude/skills/adopt-standard/SKILL.md) when setting up a repo.
