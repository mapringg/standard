#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BRANCH = process.env.EVIDENCE_BRANCH ?? "pr-evidence-assets";
if (!BRANCH.startsWith("pr-evidence-assets")) {
  console.error(`EVIDENCE_BRANCH must start with pr-evidence-assets, got ${BRANCH}`);
  process.exit(2);
}
const REMOTE = "origin";
const GIF_LIGHT_BYTES = 5_000_000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const prFlag = args.indexOf("--pr");
const prArg = prFlag === -1 ? undefined : args[prFlag + 1];
const files = args.filter((arg, i) => !arg.startsWith("--") && (prFlag === -1 || i !== prFlag + 1));

if (files.length === 0) {
  console.error("usage: upload-evidence [--dry-run] [--pr <number>] <file>...");
  process.exit(2);
}

for (const file of files) {
  const bytes = statSync(file).size;
  if (path.extname(file).toLowerCase() === ".gif" && bytes > GIF_LIGHT_BYTES) {
    console.error(`${file} is ${(bytes / 1e6).toFixed(1)} MB; shorten the clip so the PR loads quickly.`);
  }
}

const git = (gitArgs, env = {}) =>
  execFileSync("git", gitArgs, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const repo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
  encoding: "utf8",
}).trim();
const prNumber =
  prArg ??
  (() => {
    try {
      return execFileSync("gh", ["pr", "view", "--json", "number", "--jq", ".number"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      console.error("No pull request for this branch. Open it first (a draft is fine), or pass --pr <number>.");
      process.exit(2);
    }
  })();
const head = git(["rev-parse", "HEAD"]);
const prefix = `pr/${prNumber}/${head}`;

const blobs = files.map((file) => {
  const ext = path.extname(file);
  const md5 = createHash("md5").update(readFileSync(file)).digest("hex");
  return {
    file,
    target: `${prefix}/${path.basename(file, ext)}-${md5}${ext}`,
    sha: git(["hash-object", "-w", file]),
  };
});

const remoteTip = () => {
  try {
    git(["fetch", "--quiet", REMOTE, `+refs/heads/${BRANCH}:refs/remotes/${REMOTE}/${BRANCH}`]);
    return git(["rev-parse", `refs/remotes/${REMOTE}/${BRANCH}`]);
  } catch {
    return null;
  }
};

const commitOnto = (parent) => {
  const scratch = mkdtempSync(path.join(tmpdir(), "pr-evidence-"));
  const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
  try {
    if (parent) git(["read-tree", parent], env);
    for (const { target, sha } of blobs) {
      git(["update-index", "--add", "--cacheinfo", `100644,${sha},${target}`], env);
    }
    const tree = git(["write-tree"], env);
    const parentArgs = parent ? ["-p", parent] : [];
    return git(["commit-tree", tree, ...parentArgs, "-m", `Evidence: #${prNumber} at ${head}`]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const publish = (attempt = 1) => {
  const built = commitOnto(remoteTip());
  if (dryRun) return built;
  try {
    git(["push", "--quiet", "--no-verify", REMOTE, `${built}:refs/heads/${BRANCH}`]);
    return built;
  } catch (error) {
    if (attempt >= 3) throw error;
    return publish(attempt + 1);
  }
};

const commit = publish();

for (const { file, target } of blobs) {
  const alt = path.basename(file, path.extname(file));
  const url = `https://github.com/${repo}/raw/${BRANCH}/${encodeURI(target)}`;
  const ext = path.extname(file).toLowerCase();
  console.log([".mp4", ".webm"].includes(ext) ? `[${alt}${ext}](${url})` : `![${alt}](${url})`);
}
if (dryRun) console.error(`dry run: built ${commit}, nothing pushed`);
