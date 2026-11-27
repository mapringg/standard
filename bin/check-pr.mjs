#!/usr/bin/env node

import { checkEvent } from "../src/plugin/pr-check.mjs";
import { repositoryDocProblems } from "../src/plugin/repository-docs.mjs";

if (process.argv.includes("--docs") || process.env.GITHUB_EVENT_NAME === "pull_request") {
  const messages = repositoryDocProblems(process.cwd());
  if (!process.argv.includes("--docs")) messages.push(...checkEvent(process.env.GITHUB_EVENT_PATH));
  for (const message of messages) console.error(message);
  if (messages.length > 0) process.exitCode = 1;
}
