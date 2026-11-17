import { posix } from "node:path";

import { matches } from "../doc-kinds.mjs";
import { referenceFindings } from "./support/doc-references.mjs";
import { loadCorpus } from "./support/docs.mjs";

/**
 * @typedef {import("../registry.mjs").Finding} Finding
 * @typedef {import("./support/docs.mjs").Corpus} Corpus
 * @typedef {import("./support/docs.mjs").Doc} Doc
 */

const ROOTS = "an AGENTS.md, a CLAUDE.md, .gemini/styleguide.md or a SKILL.md";

/** @type {(corpus: Corpus) => Finding[]} Each file of no kind, and each doc with the obsolete marker. */
function kindFindings(corpus) {
  const kinds = corpus.misplaced.map(({ path, refused }) => ({
    key: `${path} kind`,
    fix: refused
      ? `${path} is named like a log or plan, and logs and plans are not docs. Delete it, and move any rule still in force into a conventions doc under docs/ or apps/<app>/docs/.`
      : `${path} is no kind of doc the standard allows. Move conventions to docs/<name>.md or apps/<app>/docs/<name>.md and facts about an outside system to docs/external/<name>.md, or delete it.`,
  }));
  const markers = [...corpus.docs.values()].filter((doc) => doc.marker).map(({ path }) => {
    const external = `${/^apps\/[^/]+\/docs\//.exec(path)?.[0] ?? "docs/"}external/${posix.basename(path)}`;
    return {
      key: `${path} marker`,
      fix: `${path} has <!-- check-docs: external -->, which the docs check ignores because the folder decides the kind. ${external === path ? "Delete the marker." : `Move the doc to ${external} and delete the marker.`}`,
    };
  });
  return [...kinds, ...markers];
}

/** @type {(corpus: Corpus, path: string) => string} The nearest AGENTS.md or SKILL.md above the doc, which is where its link belongs. */
function nearestRoot(corpus, path) {
  for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
    const found = ["AGENTS.md", "SKILL.md"].map((name) => posix.join(dir, name)).find((candidate) => corpus.docs.has(candidate));
    if (found || dir === ".") return found ?? "AGENTS.md";
  }
}

/** @type {(corpus: Corpus) => Finding[]} Each doc that no chain of links reaches, by a breadth-first walk from every root. */
function orphanFindings(corpus) {
  const docs = [...corpus.docs.values()];
  const queue = docs.filter((doc) => matches(doc.path, doc.kind.roots));
  const reached = new Set(queue);
  for (const doc of queue) {
    if (doc.kind.exempt) continue;
    for (const link of doc.links) {
      const target = corpus.docs.get(link.path);
      if (target && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  return docs
    .filter((doc) => !doc.kind.exempt && !reached.has(doc))
    .map(({ path }) => ({ key: `${path} orphan`, fix: `No link reaches ${path} from ${ROOTS}. Link it from ${nearestRoot(corpus, path)}.` }));
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "docs",
  since: "0.15.0",
  doc: {
    enforces: "Every tracked Markdown file is a kind of doc the standard names by path, carries no `check-docs: external` marker, and is reached by links from an AGENTS.md, a CLAUDE.md, `.gemini/styleguide.md` or a SKILL.md unless it is a README or a pull request template. A file named like a log or plan fails in any folder. The paths, links, heading anchors, `pnpm` scripts and code symbols a doc names exist; an external doc's are checked only for links and paths under a tracked top-level entry.",
    fix: "Move, delete, link or correct the doc as the finding says.",
    config: [],
  },
  subject: "tree",
  baseline: false,
  retired: ["scripts/check-docs.mjs", "scripts/check-docs.test.mjs"],
  applies: () => ({ on: true }),
  run(repo) {
    const corpus = loadCorpus(repo);
    return [...kindFindings(corpus), ...orphanFindings(corpus), ...referenceFindings(repo, corpus)];
  },
};
