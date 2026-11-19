---
name: test-audit
description: Audit existing tests before a migration or broad refactor. Decide what to keep, rewrite, trim, move, or delete.
---

# Audit tests

## Which tests to keep

Keep one test owner for each behavior. A useful test fails when the behavior breaks and still passes when the implementation changes. Assert outcomes through the public interface.

Keep tests for these contracts:

- API routes exercised through Hono `testClient` with the app's real test database.
- Authorization and permission decisions, including who can and cannot perform an action.
- External formats the app parses or produces, such as service payloads, webhooks, emails, exports, and migrations.
- Domain logic with real branches. Use tables of inputs and expected outputs.
- Regressions for real bugs with a non-obvious cause. Name the bug and assert the behavior that broke.
- Five to ten critical end-to-end journeys per app in `apps/<app>/e2e`. Keep a browser test when the interaction needs a browser to prove it.

Remove snapshots, sleep and polling tests, call-count-only assertions, render-only assertions, duplicates, and tests of framework behavior, trivial constants, or code being removed. Use MSW for HTTP doubles. When a valuable test uses an internal mock or another HTTP double, rewrite it to assert the contract at its boundary.

Before a migration, review the existing tests and record what to keep, rewrite, trim, move, or delete. Name the surviving test when removing duplicate coverage. Check that authorization, money, data integrity, and external contracts still have coverage. Apply the removals before lint autofix.

Lint checks test mechanics. Review decides whether a test protects a distinct contract.
