import { bodyOf, POINTER } from "./no-comments.mjs";
import { parseSource, sourceFiles } from "./support/sources.mjs";

/** @type {(path: string, text: string) => import("../registry.mjs").Finding[]} One per pointer, so the baseline counts them, and every pointer in a file shares its key and fix. */
function findings(path, text) {
  const { comments } = parseSource(path, text);
  const lines = comments
    .filter((comment) => POINTER.test(bodyOf(/** @type {import("./no-comments.mjs").Comment} */ (comment))))
    .map((comment) => text.slice(0, comment.start).split("\n").length)
    .sort((a, b) => a - b);
  const fix = `${path} has ${lines.length > 1 ? `See: pointers on lines ${lines.join(", ")}` : `a See: pointer on line ${lines[0]}`}. Put the decision in a name, a type or a test, and delete the pointer. The doc stays reachable from AGENTS.md.`;
  return lines.map(() => ({ key: `${path} doc-pointer`, fix }));
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "no-doc-pointers",
  since: "0.15.0",
  doc: {
    enforces: "Source holds no `See:` comment that points at a doc, which `no-comments` still allows. Its baseline records today's pointers, so none can be added and each one deleted stays deleted.",
    fix: "Put the decision in a name, a type or a test, and delete the pointer.",
    config: [],
  },
  subject: "tree",
  retired: [],
  applies: () => ({ on: true }),
  run(repo) {
    return sourceFiles(repo).flatMap((path) => {
      const text = repo.read(path);
      return text.includes("See:") ? findings(path, text) : [];
    });
  },
};
