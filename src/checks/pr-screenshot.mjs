import { FILE } from "../config.mjs";
import { git } from "../repo.mjs";
import { evidenceHasImage } from "./support/markdown.mjs";

/** A file no page renders: a lint, format or TypeScript config, a test, or a file in a __tests__ folder. */
const CANNOT_RENDER = /(?:^|\/)(?:\.oxlintrc[^/]*|\.oxfmtrc[^/]*|tsconfig[^/]*\.json|[^/]*\.test\.[^/]*)$|(?:^|\/)__tests__\//;

/** @type {import("../registry.mjs").Check} */
export default {
  name: "pr-screenshot",
  since: "0.2.0",
  doc: {
    enforces: "A pull request that changes a file matching `pr.screenshots.when` has an image in Evidence. Files no page renders never ask for one: `.oxlintrc*`, `.oxfmtrc*`, `tsconfig*.json`, `*.test.*` and anything in `__tests__`. It warns; `standard merge` enforces it.",
    fix: "Upload a screenshot with the `pr.screenshots.uploader` script and add it to Evidence, or exclude a tooling folder with a `!` entry in `when`.",
    config: ["pr.screenshots"],
  },
  subject: "pr",
  retired: ["scripts/check-pr-convention.mjs", "scripts/check-pr-convention.test.mjs", "scripts/subject-convention.mjs"],
  applies(repo) {
    return repo.config.pr.screenshots
      ? { on: true }
      : { on: false, because: `${FILE} sets no pr.screenshots` };
  },
  run(pr, repo) {
    const { when, uploader } = /** @type {{ when: readonly string[], uploader: string }} */ (
      repo.config.pr.screenshots
    );
    const range = `${pr.baseSha}...${pr.headSha}`;
    const pathspecs = when.map((glob) => (glob.startsWith("!") ? `:(glob,exclude)${glob.slice(1)}` : `:(glob)${glob}`));
    const visual = git(repo.root, "diff", "--name-only", "-z", range, "--", ...pathspecs).split("\0").filter((path) => path !== "" && !CANNOT_RENDER.test(path));
    if (visual.length === 0 || evidenceHasImage(pr.body)) return [];
    const shown = visual.length > 3 ? `${visual.slice(0, 3).join(", ")} and ${visual.length - 3} more` : visual.join(", ");
    return [
      {
        key: "Evidence",
        fix: `Evidence has no screenshot, but the PR changes ${shown}. Upload one with ${uploader}.`,
        advisory: true,
      },
    ];
  },
};
