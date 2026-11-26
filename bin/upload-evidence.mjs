#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import nodePath from "node:path";

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
  if (nodePath.extname(file).toLowerCase() === ".gif" && bytes > GIF_LIGHT_BYTES) {
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
const pr = JSON.parse(
  execFileSync("gh", ["pr", "view", ...(prArg ? [prArg] : []), "--json", "number,headRefOid"], {
    encoding: "utf8",
  }),
);
const prNumber = pr.number;
const head = pr.headRefOid;
const prefix = `pr/${prNumber}/${head}`;
const repoName = nodePath.basename(nodePath.dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"])));
const cache = nodePath.join(
  process.env.XDG_CACHE_HOME || nodePath.join(homedir(), ".cache"),
  "verification",
  repoName,
  "evidence",
);
mkdirSync(cache, { recursive: true });

const blobs = files.map((file) => {
  const ext = nodePath.extname(file);
  const md5 = createHash("md5").update(readFileSync(file)).digest("hex");
  return {
    file,
    path: `${prefix}/${nodePath.basename(file, ext)}-${md5}${ext}`,
    sha: git(["hash-object", "-w", file]),
  };
});

const remoteTip = () => {
  if (!git(["ls-remote", "--heads", REMOTE, `refs/heads/${BRANCH}`])) return null;
  git(["fetch", "--quiet", REMOTE, `+refs/heads/${BRANCH}:refs/remotes/${REMOTE}/${BRANCH}`]);
  return git(["rev-parse", `refs/remotes/${REMOTE}/${BRANCH}`]);
};

const commitTree = (parent, env) => {
  if (parent) git(["read-tree", parent], env);
  for (const { path, sha } of blobs) {
    git(["update-index", "--add", "--cacheinfo", `100644,${sha},${path}`], env);
  }
  const tree = git(["write-tree"], env);
  if (parent && tree === git(["rev-parse", `${parent}^{tree}`])) return parent;
  const parentArgs = parent ? ["-p", parent] : [];
  return git(["commit-tree", tree, ...parentArgs, "-m", `Evidence: #${prNumber} at ${head}`]);
};

const commitOnto = (parent) => {
  const scratch = mkdtempSync(nodePath.join(cache, "upload-"));
  try {
    return commitTree(parent, { GIT_INDEX_FILE: nodePath.join(scratch, "index") });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

function upload(attempt) {
  const commit = commitOnto(remoteTip());
  if (dryRun) return commit;
  try {
    git(["push", "--quiet", "--no-verify", REMOTE, `${commit}:refs/heads/${BRANCH}`]);
    return commit;
  } catch (error) {
    if (attempt >= 3) throw error;
    return upload(attempt + 1);
  }
}

const commit = upload(1);

for (const { file, path } of blobs) {
  const alt = nodePath.basename(file, nodePath.extname(file));
  const url = `https://github.com/${repo}/raw/${commit}/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  const ext = nodePath.extname(file).toLowerCase();
  console.log([".mp4", ".webm"].includes(ext) ? `[${alt}${ext}](${url})` : `![${alt}](${url})`);
}
if (dryRun) console.error(`dry run: built ${commit}, nothing pushed`);
