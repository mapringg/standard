import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isMap, isSeq, parseDocument } from "yaml";

const RELEASE = "v1.11.0";
const RELEASE_SHA = "2da38877f9f3361e0847f11aa0c7b581163b6b10";
const STANDARD = "github:mapringg/standard#";
const ACTION = "mapringg/standard/.github/actions/check-pr@";
const CHECKOUT = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const EVENTS = ["opened", "synchronize", "reopened", "edited"];
const SKILLS =
  /@mapringg\/standard\/\.claude\/skills\/(?:pr|capture|test-audit|review-standard|upgrade-standard)\/SKILL\.md|github\.com\/mapringg\/standard\/blob\/[^/]+\/\.claude\/skills\/(?:pr|capture)\/SKILL\.md/;

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function write(path, text) {
  if (read(path) === text) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function agents(root, installed) {
  const path = join(root, "AGENTS.md");
  const skillsRoot = installed
    ? "node_modules/@mapringg/standard/.claude/skills"
    : `https://github.com/mapringg/standard/blob/${RELEASE}/.claude/skills`;
  const original = read(path) ?? "# AGENTS.md\n";
  const shared = original.split("\n").filter((line) => SKILLS.test(line));
  if (
    shared.length === 2 &&
    ["pr", "capture"].every((skill) => shared.some((line) => line.includes(`${skillsRoot}/${skill}/SKILL.md)`)))
  )
    return;
  const lines = original
    .trimEnd()
    .split("\n")
    .filter((line) => !(/^\s*[-*] /.test(line) && SKILLS.test(line)));
  const links = [
    `- Use [PR writing](${skillsRoot}/pr/SKILL.md) when writing a pull request.`,
    `- Follow [Capture](${skillsRoot}/capture/SKILL.md) when preparing pull request evidence.`,
  ];
  const sources = lines.indexOf("## Sources");
  if (sources === -1) {
    lines.push("", "## Sources", "", ...links);
  } else {
    let start = sources + 1;
    while (lines[start] === "") start += 1;
    lines.splice(sources + 1, start - sources - 1, "", ...links);
    if (lines[sources + 4]?.startsWith("#")) lines.splice(sources + 4, 0, "");
  }
  write(path, `${lines.join("\n").trimEnd()}\n`);
}

function workflowFiles(root) {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => {
      const path = join(dir, name);
      const doc = parseDocument(read(path));
      if (doc.errors.length > 0) throw new Error(`Fix invalid workflow YAML in ${name} before adopting Standard.`);
      return { path, doc, data: doc.toJS() ?? {} };
    });
}

function hasPr(on) {
  if (typeof on === "string") return on === "pull_request";
  if (Array.isArray(on)) return on.includes("pull_request");
  return Boolean(on && Object.hasOwn(on, "pull_request"));
}

function enablePrEdits(doc) {
  const on = doc.get("on", true);
  if (!isMap(on)) {
    const values = isSeq(on) ? on.items.map((item) => item.value) : on?.value ? [on.value] : [];
    doc.set("on", Object.fromEntries(values.map((event) => [event, null])));
  }
  const path = ["on", "pull_request"];
  const existing = doc.getIn(path, true);
  if (!isMap(existing)) doc.setIn(path, {});
  const types = doc.getIn([...path, "types"], true);
  const events = isSeq(types) ? types.items.map((item) => item.value) : [];
  if (EVENTS.some((event) => !events.includes(event)))
    doc.setIn([...path, "types"], [...new Set([...events, ...EVENTS])]);
}

function configureCheck(root, installed) {
  const jobs = workflowFiles(root).flatMap((workflow) =>
    Object.entries(workflow.data.jobs ?? {}).map(([id, job]) => ({ ...workflow, id, job })),
  );
  const candidates = jobs.filter(({ job }) => Array.isArray(job.steps));
  const shared = candidates.find(({ job }) => job.steps.some((s) => s.uses?.startsWith(ACTION)));
  const lint =
    installed &&
    read(join(root, ".oxlintrc.json"))?.includes("@mapringg/standard/oxlint.json") &&
    candidates.find(
      ({ job, data }) =>
        hasPr(data.on) &&
        job.steps.some((s) => /(?:\bpnpm\s+(?:run\s+)?lint\b|\.githooks\/pre-push)/.test(s.run ?? "")),
    );
  const check = shared || lint;
  if (check) {
    const { doc, path, id, job } = check;
    const before = doc.toString();
    enablePrEdits(doc);
    const actionIndex = job.steps.findIndex((s) => s.uses?.startsWith(ACTION));
    if (
      actionIndex !== -1 &&
      ![`${ACTION}${RELEASE}`, `${ACTION}${RELEASE_SHA}`].includes(job.steps[actionIndex].uses)
    ) {
      doc.setIn(["jobs", id, "steps", actionIndex, "uses"], `${ACTION}${RELEASE_SHA}`);
    }
    if (doc.toString() !== before) write(path, doc.toString());
    return job.name ?? id;
  }
  const name = jobs.some(({ id, job }) => (job.name ?? id).toLowerCase() === "check") ? "Standard PR" : "Check";
  const path = join(root, ".github", "workflows", "standard-pr.yml");
  if (existsSync(path)) throw new Error("Resolve the existing standard-pr.yml before adopting Standard.");
  write(
    path,
    `name: Standard\n\non:\n  pull_request:\n    types: [${EVENTS.join(", ")}]\n  push:\n    branches: [main, develop]\n\npermissions:\n  contents: read\n\njobs:\n  check:\n    name: ${name}\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${CHECKOUT}\n        with:\n          persist-credentials: false\n      - run: test -s AGENTS.md\n      - uses: ${ACTION}${RELEASE_SHA} # ${RELEASE}\n`,
  );
  return name;
}

function pinBrowser(root) {
  const canonical = join(root, "mise.toml");
  const alternate = join(root, ".mise.toml");
  const path = existsSync(alternate) && !existsSync(canonical) ? alternate : canonical;
  const contents = read(path) ?? "";
  if (contents.includes("agent-browser")) return;
  const tool = '"npm:agent-browser" = "0.43.0"\n';
  const tools = /^\[tools\][ \t]*\n/m;
  write(
    path,
    tools.test(contents)
      ? contents.replace(tools, `$&${tool}`)
      : `${contents ? `${contents.trimEnd()}\n\n` : ""}[tools]\n${tool}`,
  );
}

export function configure(root, name, { kind = "plain", initial = false } = {}) {
  const isNewApp = kind === "app" && initial;
  const path = join(root, "package.json");
  const original = read(path);
  const manifest = original ? JSON.parse(original) : {};
  const current = manifest.devDependencies?.["@mapringg/standard"] ?? manifest.dependencies?.["@mapringg/standard"];
  const installed = typeof current === "string" && current.startsWith(STANDARD);
  const updateLock = installed && current !== `${STANDARD}${RELEASE}`;
  if (updateLock || isNewApp) {
    let next = original ?? "{}\n";
    if (updateLock) next = next.replaceAll(`"${current}"`, `"${STANDARD}${RELEASE}"`);
    if (isNewApp) next = next.replace(/"name":\s*"monorepo"/, `"name": ${JSON.stringify(name.toLowerCase())}`);
    write(path, next);
  }
  if (isNewApp) {
    const deploy = join(root, ".github", "workflows", "deploy-production.yml");
    const contents = read(deploy);
    if (contents) {
      const doc = parseDocument(contents);
      doc.set("on", "workflow_dispatch");
      write(deploy, doc.toString());
    }
  }
  if (kind === "app") pinBrowser(root);
  agents(root, installed);
  return { check: configureCheck(root, installed), updateLock };
}
