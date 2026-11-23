import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { anchorFor, listFiles, locate } from "./paths.mjs";

const CODE = /\.[cm]?[jt]sx?$/;
const WORKFLOWS = ".github/workflows";
const MESSAGE =
  "Run `pnpm exec standard-pr` with GITHUB_TOKEN in a pull_request workflow that also triggers on edited; see the standard README.";
const CACHE_MS = 2000;
const scans = new Map();

function wired(root) {
  const dir = join(root, WORKFLOWS);
  if (!existsSync(dir)) return false;
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .some((name) => readFileSync(join(dir, name), "utf8").includes("standard-pr"));
}

function anchorOf(root) {
  const cached = scans.get(root);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.anchor;
  const adopted = existsSync(join(root, "node_modules/@mapringg/standard/package.json"));
  const anchor =
    adopted && !wired(root)
      ? anchorFor(
          "",
          listFiles(root).filter((rel) => CODE.test(rel)),
        )
      : null;
  scans.set(root, { time: Date.now(), anchor });
  return anchor;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Repos on the standard run its PR check in CI. Reports on the first linted file." },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where || anchorOf(where.root) !== where.rel) return {};
    return {
      Program(node) {
        context.report({ node, message: MESSAGE });
      },
    };
  },
};
