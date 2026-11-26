#!/usr/bin/env node

import { checkEvent } from "../src/plugin/pr-check.mjs";

if (process.env.GITHUB_EVENT_NAME === "pull_request") {
  const messages = checkEvent(process.env.GITHUB_EVENT_PATH);
  for (const message of messages) console.error(message);
  if (messages.length > 0) process.exitCode = 1;
}
