---
name: upgrade-standard
description: Upgrade a repository to a newer @mapringg/standard tag, or adopt it for the first time, with a passing baseline commit and one reviewable commit per rule.
---

# Upgrade the standard

## Commit a passing baseline

1. Run `pnpm lint` on the current version and confirm it passes. Fix or report an existing failure before upgrading.
2. Point `@mapringg/standard` at the new release tag. Pin `knip`, `oxfmt`, `oxlint` and `tsrs` to the exact versions in that tag's `peerDependencies`. Run `pnpm install`.
3. Follow the installed [setup guide](../adopt-standard/SKILL.md) and apply any changes it calls for, such as scripts, `tsconfig.json` or `package.json` imports.
4. Run `pnpm lint`. Set each newly failing rule to `"off"` in `rules` of the root `.oxlintrc.json`. If a standard override turns a rule back on for some files, add an override with the same `files` that turns it off there too.
5. Run `pnpm lint`, `pnpm knip` and the format check until they pass. Commit the dependency, config and setup changes as one baseline.

## Enable one rule per commit

1. Remove one rule's temporary `"off"`, fix its findings, and rerun lint. Run the tests and type checks for code whose behavior or types changed. Commit the config and the fixes together.
2. Fix `shadcn/*` findings in the order the [design system section](../adopt-standard/SKILL.md#design-system) gives, never with a local exception.
3. A rule that reports correct code is a gap in the standard, not a local exception. Leave its `"off"` in place and open an issue or pull request on mapringg/standard with the code it reports. For an owner ban, ask for a row in the owners table.
4. Repeat for each temporary `"off"`. Remove a temporary `"off"` once a release fixes the gap.

## Review and squash

Open one pull request with the baseline and every rule commit. List each rule that stays off with a link to its issue or pull request on mapringg/standard, and include the lint and test results. Keep the commits through review and squash them when merging.
