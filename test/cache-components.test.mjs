import assert from "node:assert/strict";
import { test } from "node:test";

import { git, standard, tempRepo, write } from "./helpers.mjs";

const NEXT = { dependencies: { next: "16.0.0", react: "19.0.0" } };
const SET = "Set cacheComponents: true at the top level of the object it exports, as Next 16 reads it.";

function check(t, files) {
  const cwd = tempRepo(t);
  write(cwd, files);
  git(cwd, "add", "-A");
  return standard(cwd, ["check", "cache-components"]);
}

function fails(t, files, ...fixes) {
  const { stdout, stderr, status } = check(t, files);
  assert.equal(stderr, "");
  assert.equal(stdout, fixes.map((fix) => `cache-components: ${fix.split(/ |\//).slice(0, 2).join("/")} cacheComponents: ${fix}\n`).join(""));
  assert.equal(status, 1);
}

test("cache-components passes a config that sets cacheComponents: true through each export form it can read", (t) => {
  const { stdout, stderr, status } = check(t, {
    "apps/a/package.json": NEXT,
    "apps/a/next.config.mjs": "export default { cacheComponents: true };\n",
    "apps/b/package.json": NEXT,
    "apps/b/next.config.ts": 'import type { NextConfig } from "next";\nconst nextConfig: NextConfig = { reactStrictMode: true, cacheComponents: true };\nexport default nextConfig;\n',
    "apps/c/package.json": NEXT,
    "apps/c/next.config.ts": 'import createNextIntlPlugin from "next-intl/plugin";\nimport { withSentryConfig } from "@sentry/nextjs";\nconst withNextIntl = createNextIntlPlugin();\nconst base = { images: {} };\nexport default withSentryConfig(withNextIntl({ ...base, cacheComponents: true } satisfies NextConfig), { silent: true });\n',
    "apps/d/package.json": NEXT,
    "apps/d/next.config.js": "module.exports = { cacheComponents: true };\n",
    "apps/e/package.json": NEXT,
    "apps/e/next.config.mjs": "const shared = { cacheComponents: true };\nexport default (phase) => {\n  return { ...shared, output: phase };\n};\n",
    "packages/ui/package.json": { dependencies: { react: "19.0.0" } },
  });
  assert.deepEqual({ stdout, stderr, status }, { stdout: "cache-components: OK\n", stderr: "", status: 0 });
});

test("cache-components fails a Next app whose config leaves cacheComponents off, misplaces it, or hides it", (t) => {
  fails(
    t,
    {
      "apps/missing/package.json": NEXT,
      "apps/missing/next.config.ts": "export default { reactStrictMode: true };\n",
      "apps/off/package.json": NEXT,
      "apps/off/next.config.mjs": "export default { cacheComponents: true, ...{ cacheComponents: false } };\n",
      "apps/old/package.json": NEXT,
      "apps/old/next.config.mjs": "export default { experimental: { cacheComponents: true } };\n",
      "apps/env/package.json": NEXT,
      "apps/env/next.config.mjs": 'export default { cacheComponents: process.env.CACHE === "1" };\n',
      "apps/made/package.json": NEXT,
      "apps/made/next.config.mjs": 'import { makeConfig } from "./config.mjs";\nexport default makeConfig();\n',
      "apps/none/package.json": NEXT,
    },
    `apps/env/next.config.mjs sets cacheComponents on line 1 to a value the check cannot read. ${SET}`,
    `apps/made/next.config.mjs exports a config the check cannot read on line 2: a call that takes no object it can read. Export an object, or pass one to the plugin call, and set cacheComponents: true at its top level.`,
    `apps/missing/next.config.ts does not set cacheComponents. ${SET}`,
    `apps/none has no next.config file. Add next.config.ts that exports { cacheComponents: true }.`,
    `apps/off/next.config.mjs sets cacheComponents on line 1 to false. ${SET}`,
    `apps/old/next.config.mjs sets cacheComponents under experimental on line 1. Next 16 reads it at the top level, so move it there.`,
  );
});

test("cache-components keeps no baseline, so a repository stages it in pending until its switch lands", (t) => {
  const cwd = tempRepo(t, { pending: ["cache-components"] });
  write(cwd, { "apps/a/package.json": NEXT, "apps/a/next.config.mjs": "export default {};\n" });
  git(cwd, "add", "-A");
  assert.equal(standard(cwd, ["check", "cache-components"]).stdout.trim(), "cache-components: pending in .standard/config.json, so it did not run");
  assert.notEqual(standard(cwd, ["check", "cache-components", "--init"]).status, 0);
});
