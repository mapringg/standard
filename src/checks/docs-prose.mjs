import { REQUIRED_HEADINGS } from "./pr-body.mjs";
import { loadCorpus } from "./support/docs.mjs";

/**
 * @typedef {import("../registry.mjs").Finding} Finding
 * @typedef {import("./support/docs.mjs").Corpus} Corpus
 * @typedef {import("./support/docs.mjs").Doc} Doc
 * @typedef {{ line: number, note?: string }} Hit
 */

const MAX_WORDS = 40;
const DASH = /[–—]/g;
const FILLERS = ["comprehensive", "robust", "seamlessly", "seamless", "leverage", "utilize", "crucial", "delve", "simply", "just", "very", "really", "basically", "actually", "in order to", "note that", "worth noting"];
const FILLER = new RegExp(`(?<![\\w-])(?:${FILLERS.map((filler) => filler.replaceAll(" ", "\\s+")).join("|")})(?![\\w-])`, "gi");

/** @type {(word: string) => string} The word without the punctuation around it or a possessive. */
const core = (word) => word.replace(/^[^\p{L}\p{N}]+/u, "").replace(/(?:['’]s)?[^\p{L}\p{N}]*$/u, "");

/** @type {(corpus: Corpus) => ReadonlySet<string>} The capitalized words some doc's prose writes mid-sentence, which are proper names. */
function properNames(corpus) {
  return new Set([...corpus.docs.values()].flatMap((doc) => doc.sentences.flatMap(({ words }) => words.slice(1).map(core).filter((word) => /^\p{Lu}/u.test(word)))));
}

/** @type {(heading: import("./support/docs.mjs").Heading, proper: ReadonlySet<string>) => boolean} */
function titleCase(heading, proper) {
  if (REQUIRED_HEADINGS.includes(heading.text)) return false;
  let starts = true;
  for (const word of heading.words.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, "").split(/\s+/).filter(Boolean)) {
    const bare = core(word);
    if (!starts && /^\p{Lu}/u.test(bare) && !/^[\p{Lu}\p{N}]+$/u.test(bare) && !/.[\p{Lu}.]/u.test(bare) && !proper.has(bare)) return true;
    starts = /[.:?!]$/.test(word);
  }
  return false;
}

/** @type {(doc: Doc, proper: ReadonlySet<string>) => Finding[]} One finding per occurrence, so the baseline counts them, and every occurrence of a rule in a doc shares its key and fix. */
function proseFindings(doc, proper) {
  /** @type {[string, Hit[], (list: string) => string][]} */
  const rules = [
    ["dash", doc.plain.flatMap(({ line, text }) => [...text.matchAll(DASH)].map(() => ({ line }))), (list) => `has en or em dashes on lines ${list}. Use a comma, a colon, parentheses or two sentences, and write ranges as "1 to 3".`],
    ["heading", doc.headings.filter((heading) => titleCase(heading, proper)).map(({ line, text }) => ({ line, note: `"${text}"` })), (list) => `has headings not in sentence case on ${list}. Capitalize only the first word and proper names.`],
    ["filler", doc.plain.flatMap(({ line, text }) => [...text.matchAll(FILLER)].map((match) => ({ line, note: `"${match[0]}"` }))), (list) => `uses filler on ${list}. Delete it, or name the specific thing it stands in for.`],
    ["length", doc.sentences.filter(({ words }) => words.length > MAX_WORDS).map(({ line, words }) => ({ line, note: `(${words.length} words)` })), (list) => `has sentences over ${MAX_WORDS} words on ${list}. Split each one.`],
  ];
  return rules.flatMap(([rule, hits, fix]) => {
    const list = hits.every((hit) => hit.note === undefined) ? [...new Set(hits.map((hit) => hit.line))].join(", ") : hits.map((hit) => `line ${hit.line} ${hit.note}`).join(", ");
    return hits.map(() => ({ key: `${doc.path} ${rule}`, fix: `${doc.path} ${fix(list)}` }));
  });
}

/** @type {import("../registry.mjs").Check} */
export default {
  name: "docs-prose",
  since: "0.15.0",
  doc: {
    enforces: `Docs of every kind use no en or em dash and none of a fixed list of filler words outside code, headings in sentence case, and prose sentences of at most ${MAX_WORDS} words, where a code span or a link is one word. A capitalized heading word passes when it is all capitals, has an inner capital or dot, starts a sentence, or some doc's prose writes it capitalized mid-sentence. The headings \`pr-body\` requires pass.`,
    fix: "Rewrite the sentence or heading as the finding says.",
    config: [],
  },
  subject: "tree",
  retired: [],
  applies: () => ({ on: true }),
  run(repo) {
    const corpus = loadCorpus(repo);
    const proper = properNames(corpus);
    return [...corpus.docs.values()].flatMap((doc) => proseFindings(doc, proper));
  },
};
