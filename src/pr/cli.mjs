#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { check } from "./check.mjs";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const USAGE =
  "Run in a pull_request workflow with GITHUB_TOKEN set, or locally as GITHUB_TOKEN=$(gh auth token) standard-pr owner/repo#123.";

function target() {
  const arg = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(process.argv[2] ?? "");
  if (arg) return { repo: arg[1], number: Number(arg[2]) };
  const path = process.env.GITHUB_EVENT_PATH;
  const number = path ? JSON.parse(readFileSync(path, "utf8")).pull_request?.number : undefined;
  if (!number || !process.env.GITHUB_REPOSITORY) throw new Error(USAGE);
  return { repo: process.env.GITHUB_REPOSITORY, number };
}

async function get(path) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}. ${USAGE}`);
  return response.json();
}

async function all(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await get(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

const { repo, number } = target();
const [pull, commits, files, open] = await Promise.all([
  get(`/repos/${repo}/pulls/${number}`),
  all(`/repos/${repo}/pulls/${number}/commits`),
  all(`/repos/${repo}/pulls/${number}/files`),
  all(`/repos/${repo}/pulls?state=open`),
]);
const problems = check({
  number,
  body: pull.body,
  bot: pull.user.type === "Bot",
  files: files.map((item) => item.filename),
  commits: commits.map((item) => item.sha),
  open: open.map((item) => ({ number: item.number, sha: item.head.sha })),
});
for (const problem of problems) console.error(problem);
if (problems.length > 0) {
  console.error(`\n${repo}#${number} breaks the PR shape. Fix the lines above.`);
  process.exitCode = 1;
} else if (pull.user.type === "Bot") console.log(`${repo}#${number} is by a bot; skipped.`);
else console.log(`${repo}#${number} follows the PR shape.`);
