import { readFileSync } from "node:fs";
import { join } from "node:path";

import { anchorFor, listFiles, locate } from "./paths.mjs";

const CODE = /\.[cm]?[jt]sx?$/;
const CONFIG = /(?:^|\/)\.?oxlintrc\.jsonc?$/;
const CACHE_MS = 2000;
const scans = new Map();

function shadcnRules(rules) {
  return Object.entries(rules ?? {}).filter(([name]) => name.startsWith("shadcn/"));
}

function configProblems(config) {
  const found = [];
  if (config.settings?.shadcn !== undefined)
    found.push("Delete settings.shadcn and import components from #/components/ui as Standard expects.");
  for (const [name, value] of shadcnRules(config.rules)) {
    if (value !== "off")
      found.push(
        `Delete the ${name} setting and fix the code with a variant, size, margin or a new component variant.`,
      );
  }
  for (const override of config.overrides ?? []) {
    for (const [name] of shadcnRules(override.rules))
      found.push(`Delete the ${name} override and fix those files, or change the standard.`);
  }
  return found;
}

function scan(root) {
  const files = listFiles(root);
  const lintable = files.filter((rel) => CODE.test(rel));
  const findings = new Map();
  for (const rel of files.filter((file) => CONFIG.test(file))) {
    let config;
    try {
      config = JSON.parse(readFileSync(join(root, rel), "utf8"));
    } catch {
      continue;
    }
    const problems = configProblems(config);
    const anchor = anchorFor(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "", lintable);
    if (!anchor || problems.length === 0) continue;
    findings.set(anchor, [...(findings.get(anchor) ?? []), ...problems.map((message) => `${rel}: ${message}`)]);
  }
  return findings;
}

function findingsFor(root) {
  const cached = scans.get(root);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.findings;
  const findings = scan(root);
  scans.set(root, { time: Date.now(), findings });
  return findings;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Projects keep Standard's design system rules as shipped and may only turn one off while upgrading.",
    },
  },
  create(context) {
    const where = locate(context.filename);
    if (!where) return {};
    return {
      Program(node) {
        for (const message of findingsFor(where.root).get(where.rel) ?? []) context.report({ node, message });
      },
    };
  },
};
