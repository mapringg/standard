---
name: capture
description: Capture and attach before and after evidence when preparing a pull request.
---

# Capture PR evidence

Choose proof based on what changed.

- Use before and after PNG screenshots when still images show the visible difference.
- Use short MP4 recordings when motion, timing, or the sequence of an interaction is the difference.
- Use test or command output when the change has no visible effect. Skip media.

Follow the repo’s verification instructions for how to start the app, load test data, and reach the relevant state.
Use test accounts and fixtures. Compare the same scenario on the base and head with the same viewport and theme.
Use an isolated checkout for the base when it needs a separate build or database.

For web evidence, use the project’s pinned Agent Browser and run `agent-browser skills get core` through the same
launcher to load its command guide. For example, a mise project uses `mise exec -- agent-browser skills get core`.
Use a dedicated browser session per worktree. Wait for the expected state before taking a screenshot. Start recording
before the action and stop afterward to save the clip. Recording requires FFmpeg. Close the session when finished.

Use the platform’s capture tool for a native UI. If capture is blocked, state the specific blocker in Evidence and
include any execution results that show the behavior.

Put proof under **Before** and **After** in the PR. Use GitHub attachments where available. If the repo uses Standard’s
uploader, run `pnpm exec upload-evidence` with the finished files and put its Markdown in the PR.
