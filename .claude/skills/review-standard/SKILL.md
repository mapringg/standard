---
name: review-standard
description: Review a pull request or branch against the parts of the standard that require judgment.
---

# Review against the standard

1. Read the installed standard README and the repository and app `AGENTS.md` files that apply to the diff.
2. Diff against `origin/develop`. Use `origin/main` when the repository has no develop branch.
3. Review changed lines for simplifications lint and types cannot judge. Look for redundant code, tests, files, dependencies, and agent instructions. Use the [test audit policy](../test-audit/SKILL.md) when deciding whether a test earns its place.
4. Ask for a concrete removal or simplification. Keep the behavior and coverage the removed code owns.
5. Report one finding per line in the form `path:line rule: what to remove or simplify`. With no findings, say `No findings.`
