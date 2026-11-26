---
name: pr
description: "Use when starting work on a request, pushing to a branch or writing a PR title or body."
metadata:
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

## One change per PR

- Give each new request its own branch from the latest base and its own PR, even while another PR is open.
- Push to an open PR only to fix that PR's own change or answer its review.
- When a request needs an unmerged PR, branch from that PR and name it in the new PR.
- When unsure whether a request belongs to an open PR, open a new one.

## PR title

The title becomes the squash commit subject. Write one plain sentence that starts with a capitalised verb, such as "Allow shared URL parameter owners". Skip `type(scope):` prefixes and the trailing period. Keep it within 80 characters including ` (#<number>)`.

## PR body

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

Put that proof in the PR, not only in the chat:

- Capture before and after with the same browser tool and viewport. For before, commit the change, run `git checkout <base> -- <files>` and restart the app; for after, run `git checkout HEAD -- <files>` and restart it again.
- Record only what a still cannot show, such as loading or a transition, and keep the clip under about 15 seconds.
- Open the PR first (a draft is fine). Then run `pnpm exec upload-evidence [--pr <number>] <files>` and paste the Markdown it prints into Evidence. It commits the files to the `pr-evidence-assets` branch under `pr/<number>/<head sha>/`, links them at that evidence commit, embeds images and links videos.
- When a user-visible change has no screenshot or recording, say why in Evidence.

## Merge Danger

A two-way door is cheap to roll back; destructive or hard-to-reverse changes (migrations, deleted data, public API removals) are one-way. The blast radius is who or what the change can hurt: consumers, layout, mobile, other apps.
