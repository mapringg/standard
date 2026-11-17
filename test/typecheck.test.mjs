import assert from "node:assert/strict";
import { test } from "node:test";

import { git, standard, tempRepo, WIRED, write } from "./helpers.mjs";

const BASE = "@mapringg/standard/tsconfig";

const CLEAN = {
  ...WIRED,
  ".standard/config.json": { hooks: { "pre-push": ["pnpm typecheck"] } },
  "package.json": { ...WIRED["package.json"], scripts: { ...WIRED["package.json"].scripts, typecheck: "tsc --noEmit" } },
  ".gitignore": "node_modules\n",
  ".github/workflows/ci.yml": `${WIRED[".github/workflows/ci.yml"]}      - run: pnpm run typecheck && pnpm run lint\n`,
  "tsconfig.json": { extends: BASE, compilerOptions: { module: "nodenext", strict: true } },
};

function typecheck(t, files) {
  const cwd = tempRepo(t);
  write(cwd, Object.fromEntries(Object.entries({ ...CLEAN, ...files }).filter(([, content]) => content !== null)));
  git(cwd, "add", "-A");
  const { stdout, status } = standard(cwd, ["check", "typecheck"]);
  return { stdout, status, cwd };
}

const ASTRO = {
  "node_modules/astro/package.json": { name: "astro", exports: { "./tsconfigs/*": "./tsconfigs/*.json" } },
  "node_modules/astro/tsconfigs/strict.json": { compilerOptions: { jsx: "preserve", strict: true } },
};

function fails(t, files, ...lines) {
  const { stdout, status } = typecheck(t, files);
  assert.equal(stdout, lines.map((line) => `typecheck: ${line}\n`).join(""));
  assert.equal(status, 1);
}

test("typecheck passes a repository whose project extends the base and runs typecheck everywhere", (t) => {
  assert.deepEqual([typecheck(t, {}).stdout, typecheck(t, {}).status], ["typecheck: OK\n", 0]);
});

test("typecheck fails a project that does not extend the base", (t) => {
  fails(t, { "tsconfig.json": { compilerOptions: { strict: true } } }, `tsconfig.json extends: Add "${BASE}" as the last entry of extends in tsconfig.json, so the project builds on the shared strict flags.`);
});

test("typecheck reports a missing base only on the project a child config extends", (t) => {
  fails(
    t,
    { "tsconfig.json": { compilerOptions: { strict: true } }, "tsconfig.build.json": { extends: "./tsconfig.json" } },
    `tsconfig.json extends: Add "${BASE}" as the last entry of extends in tsconfig.json, so the project builds on the shared strict flags.`,
  );
});

test("typecheck follows extends through a local file and judges the files after the base", (t) => {
  const build = { "tsconfig.build.json": { extends: "./tsconfig.json", compilerOptions: { outDir: "dist" } } };
  assert.equal(typecheck(t, build).stdout, "typecheck: OK\n");
  fails(
    t,
    { "tsconfig.build.json": { extends: "./tsconfig", compilerOptions: { strictNullChecks: false } } },
    "tsconfig.build.json compilerOptions.strictNullChecks: Remove compilerOptions.strictNullChecks from tsconfig.build.json, which sets false where the shared base sets true.",
  );
});

test("typecheck reports a local parent that turns a flag off once, however many projects share it", (t) => {
  fails(
    t,
    {
      "tsconfig.base.json": { extends: BASE, compilerOptions: { noUncheckedIndexedAccess: false } },
      "tsconfig.json": { extends: "./tsconfig.base.json" },
      "tsconfig.test.json": { extends: "./tsconfig.base.json" },
    },
    "tsconfig.base.json compilerOptions.noUncheckedIndexedAccess: Remove compilerOptions.noUncheckedIndexedAccess from tsconfig.base.json, which sets false where the shared base sets true.",
  );
});

test("typecheck wants a preset before the base, since a later entry overrides an earlier one", (t) => {
  assert.equal(typecheck(t, { ...ASTRO, "tsconfig.json": { extends: ["astro/tsconfigs/strict", BASE] } }).stdout, "typecheck: OK\n");
  fails(
    t,
    { ...ASTRO, "tsconfig.json": { extends: [BASE, "astro/tsconfigs/strict"] } },
    `tsconfig.json extends astro/tsconfigs/strict: Move "astro/tsconfigs/strict" before "${BASE}" in extends of tsconfig.json, since a later entry overrides an earlier one.`,
  );
});

test("typecheck follows a package preset to the base and judges what the preset sets after it", (t) => {
  const preset = (options) => ({
    "node_modules/my-preset/package.json": { name: "my-preset", tsconfig: "base.json" },
    "node_modules/my-preset/base.json": `// the preset\n{ "extends": "${BASE}", "compilerOptions": ${JSON.stringify(options)} }`,
    "tsconfig.json": { extends: "my-preset" },
  });
  assert.equal(typecheck(t, preset({ target: "es2024" })).stdout, "typecheck: OK\n");
  fails(
    t,
    preset({ exactOptionalPropertyTypes: false }),
    "node_modules/my-preset/base.json compilerOptions.exactOptionalPropertyTypes: Remove compilerOptions.exactOptionalPropertyTypes from node_modules/my-preset/base.json, which sets false where the shared base sets true.",
  );
});

test("typecheck fails an extends that TypeScript cannot resolve", (t) => {
  for (const specifier of ["nonexistent-preset", "${configDir}/configs/base.json"]) {
    fails(
      t,
      { "tsconfig.json": { extends: [specifier, BASE] } },
      `tsconfig.json extends ${specifier}: Make "${specifier}" in extends of tsconfig.json name a config TypeScript finds: a file git tracks, or an installed package's config.`,
    );
  }
});

test("typecheck reports an extends it cannot follow", (t) => {
  fails(
    t,
    { "tsconfig.json": { extends: ["./nope.json", BASE] } },
    `tsconfig.json extends ./nope.json: Make "./nope.json" in extends of tsconfig.json name a config TypeScript finds: a file git tracks, or an installed package's config.`,
  );
  fails(
    t,
    { "tsconfig.json": { extends: ["./tsconfig.json", BASE] } },
    'tsconfig.json extends ./tsconfig.json: Remove "./tsconfig.json" from extends in tsconfig.json, which leads back to tsconfig.json in a cycle.',
  );
  const { stdout } = typecheck(t, { "tsconfig.json": "{ extends: x }" });
  assert.match(stdout, /^typecheck: tsconfig\.json: Make tsconfig\.json a valid tsconfig\. /);
  fails(
    t,
    { "tsconfig.json": { extends: BASE, compilerOptions: "not an object" } },
    "tsconfig.json: Make tsconfig.json a valid tsconfig. compilerOptions is not an object.",
  );
});

test("typecheck skips a solution file and judges the projects it references", (t) => {
  const files = {
    "tsconfig.json": { files: [], references: [{ path: "apps/api" }] },
    "apps/api/tsconfig.json": { extends: BASE },
    "apps/api/package.json": { scripts: { typecheck: "tsc --noEmit" } },
  };
  assert.equal(typecheck(t, files).stdout, "typecheck: OK\n");
  fails(
    t,
    { ...files, "tsconfig.json": { references: [{ path: "apps/api" }] } },
    `tsconfig.json extends: Add "${BASE}" as the last entry of extends in tsconfig.json, so the project builds on the shared strict flags.`,
  );
});

test("typecheck reads JSON with comments and trailing commas", (t) => {
  const text = `{\n  // the shared base\n  "extends": ["${BASE}",],\n  /* env */ "compilerOptions": { "target": "es2024", "maxNodeModuleJsDepth": -1, },\n}\n`;
  assert.equal(typecheck(t, { "tsconfig.json": text }).stdout, "typecheck: OK\n");
  assert.equal(typecheck(t, { "tsconfig.json": `{"extends":"${BASE}"} // last comment` }).stdout, "typecheck: OK\n");
});

test("typecheck wants a typecheck script at the root and in each project's package", (t) => {
  fails(
    t,
    {
      "package.json": WIRED["package.json"],
      "apps/web/tsconfig.json": { extends: BASE },
      "apps/web/package.json": { name: "web" },
      "apps/web/src/tsconfig.json": { extends: "../tsconfig.json" },
    },
    'package.json scripts.typecheck: Add a typecheck script such as "turbo run typecheck" to package.json, so CI and pre-push have one command to run.',
    'apps/web/package.json scripts.typecheck: Add a typecheck script such as "tsc --noEmit" to apps/web/package.json, so the root typecheck covers apps/web/src/tsconfig.json.',
  );
});

test("typecheck wants a typecheck script for a package whose only project is a named tsconfig", (t) => {
  fails(
    t,
    { "packages/tools/package.json": { name: "tools" }, "packages/tools/tsconfig.editor.json": { extends: BASE } },
    'packages/tools/package.json scripts.typecheck: Add a typecheck script such as "tsc --noEmit -p tsconfig.editor.json" to packages/tools/package.json, so the root typecheck covers packages/tools/tsconfig.editor.json.',
  );
});

test("typecheck wants pre-push to run typecheck", (t) => {
  const hook = (line) => ({ ".standard/config.json": { hooks: { "pre-push": [line] } } });
  assert.equal(typecheck(t, hook("pnpm lint && pnpm run typecheck")).stdout, "typecheck: OK\n");
  for (const line of ["pnpm run typecheck:foo", 'echo "pnpm typecheck"', "pnpm typecheck || true", "pnpm typecheck; true"]) {
    fails(t, hook(line), 'hooks.pre-push: Add "pnpm typecheck" to hooks.pre-push in .standard/config.json, so a push that fails typecheck stops before CI.');
  }
});

test("typecheck wants a Check job step whose run is the typecheck command", (t) => {
  const ci = (step) => ({ ".github/workflows/ci.yml": `${WIRED[".github/workflows/ci.yml"]}${step}` });
  const miss = 'ci: Add a step to the Check job whose run is "pnpm typecheck", with no continue-on-error, so a pull request that fails typecheck cannot merge.';
  assert.equal(typecheck(t, ci("      - if: ${{ !cancelled() }}\n        run: |\n          pnpm typecheck\n")).stdout, "typecheck: OK\n");
  fails(t, ci(""), miss);
  fails(t, ci("      - run: |\n          pnpm run typecheck; x=$?\n          exit $x\n"), miss);
  fails(t, ci("      - run: |\n          run-parallel.sh \\\n            'pnpm run typecheck'\n"), miss);
  fails(t, ci('      - run: echo "pnpm typecheck"\n'), miss);
  fails(t, ci("      - run: pnpm typecheck || true\n"), miss);
  fails(t, ci("      - run: pnpm typecheck\n        shell: bash {0}\n"), miss);
  fails(t, ci("      - run: pnpm typecheck\n        continue-on-error: true\n"), miss);
  fails(t, ci("      - run: pnpm run typecheck:foo\n"), miss);
});

test("typecheck leaves a repository without a Check job to the ci probe", (t) => {
  assert.equal(typecheck(t, { ".github/workflows/ci.yml": null }).stdout, "typecheck: OK\n");
});

test("typecheck keeps no baseline, pending holds it off, and it skips a repository without a tsconfig", (t) => {
  const { stdout, status } = typecheck(t, { "tsconfig.json": {}, ".standard/config.json": { pending: ["typecheck"] } });
  assert.deepEqual([stdout, status], ["typecheck: pending in .standard/config.json, so it did not run\n", 0]);
  assert.equal(typecheck(t, { "tsconfig.json": null }).stdout, "typecheck: skipped, git tracks no tsconfig.json\n");
});
