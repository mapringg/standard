---
name: pr
description: "Use when writing a PR body."
metadata:
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

Write the PR body with this template. Skip preambles, keep prose brief and use the project's domain words.

```markdown
## Summary

<one visual>

## Evidence

- **Before:** <screenshot, output or failing test>
  **After:** <screenshot, output or passing test>

## Merge Danger

**Door:** <one-way or two-way>

**Blast Radius:** <one word>

<optional: what could break>
```

## Summary

Pick the smallest visual that makes the point, next to one or two sentences:

- Logic: pseudocode.
- Runtime flow: a call tree.
- UI: a component tree with the state and module boundaries that matter.
- Layout or a broad refactor: a shallow file tree.
- Interaction or data flow: a Mermaid sequence diagram.
- A change to an existing shape: a `diff` block of that tree, call tree or pseudocode.
- Mostly new code: the whole target block.

Show only the calls, files, props and states the reviewer needs.

## Evidence

User-visible changes need the verify skill's proof: screenshots or a recording, plus the commands run. Otherwise show test or console output, naming the test that failed before and passes now. A PR that adds a test names the contract it protects, the realistic bug that breaks it and why no existing test catches it.

## Merge Danger

A two-way door is cheap to roll back; destructive or hard-to-reverse changes (migrations, deleted data, public API removals) are one-way. The blast radius is who or what the change can hurt: consumers, layout, mobile, other apps.
