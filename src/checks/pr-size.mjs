import { expectOk, githubFromEnv, githubPages, githubRequest } from "../github.mjs";

const SIZES = [
  { label: "size:XS", color: "0e8a16", below: 10 },
  { label: "size:S", color: "5ebd3e", below: 30 },
  { label: "size:M", color: "fbca04", below: 100 },
  { label: "size:L", color: "fe7d37", below: 500 },
  { label: "size:XL", color: "d93f0b", below: 1000 },
  { label: "size:XXL", color: "b60205", below: Infinity },
];
const UNCOUNTED = /(^|\/)pnpm-lock\.yaml$/;
const TEST = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[^/]+$/;

/**
 * @typedef {import("../subjects.mjs").LineChange} LineChange
 * @typedef {{ label: string, color: string, lines: number }} Size
 */

/**
 * @param {readonly LineChange[]} changes
 * @returns {Size}
 */
export function sizeOf(changes) {
  const counted = changes.filter(({ path }) => !UNCOUNTED.test(path));
  /** @param {readonly LineChange[]} selected */
  const linesOf = (selected) => selected.reduce((total, change) => total + change.additions + change.deletions, 0);
  const nonTest = linesOf(counted.filter(({ path }) => !TEST.test(path)));
  const lines = nonTest > 0 ? nonTest : linesOf(counted);
  const { label, color } = /** @type {(typeof SIZES)[number]} */ (SIZES.find(({ below }) => lines < below));
  return { label, color, lines };
}

/**
 * @param {import("../github.mjs").GitHub} github
 * @param {number} number
 * @param {Size} size
 */
async function setLabel(github, number, size) {
  await expectOk(
    githubRequest(github, "POST", "labels", {
      name: size.label,
      color: size.color,
      description: "Changed lines, without the lockfile and, unless only tests changed, tests",
    }),
    [422],
  );
  for (const { name } of await githubPages(github, `issues/${number}/labels`)) {
    if (name.startsWith("size:") && name !== size.label) {
      await expectOk(githubRequest(github, "DELETE", `issues/${number}/labels/${encodeURIComponent(name)}`), [404]);
    }
  }
  await expectOk(githubRequest(github, "POST", `issues/${number}/labels`, { labels: [size.label] }));
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "pr-size",
  since: "0.3.0",
  subject: "pr",
  retired: [
    "scripts/pr-size-label.mjs",
    "scripts/pr-size-label.test.mjs",
    "scripts/github-api.mjs",
    "scripts/github-api.test.mjs",
  ],
  summary(pr) {
    const { label, lines } = sizeOf(pr.lineChanges);
    return `${label}, ${lines} changed line(s) (#${pr.number})`;
  },
  async run(pr) {
    const github = githubFromEnv(process.env);
    if (github === null) return [];
    const size = sizeOf(pr.lineChanges);
    try {
      await setLabel(github, pr.number, size);
      return [];
    } catch (error) {
      return [
        {
          key: size.label,
          fix: `Could not set the label. ${/** @type {Error} */ (error).message}`,
          advisory: true,
        },
      ];
    }
  },
};
