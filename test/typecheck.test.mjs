import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { git, installPackage, standard, tempRepo, WIRED, write } from "./helpers.mjs";

const BASE = "@mapringg/standard/tsconfig";
const COMPILERS = { 7: join(import.meta.dirname, "../node_modules/typescript"), 6: join(import.meta.dirname, "../node_modules/typescript-6") };
const EXTENDS_MISSING = (path) => `${path} extends: Add "${BASE}" as the last entry of extends in ${path}, so the project builds on the shared strict flags.`;
const FLAG_OFF = (path, flag, value) =>
  `${path} compilerOptions.${flag}: ${path} ends up with ${flag} set to ${value}, but the shared base sets true. Remove the setting that overrides it, in ${path} or a config it extends after the base.`;

const CLEAN = {
  ...WIRED,
  ".standard/config.json": { hooks: { "pre-push": ["pnpm typecheck"] } },
  "package.json": { ...WIRED["package.json"], scripts: { ...WIRED["package.json"].scripts, typecheck: "tsc --noEmit" } },
  ".gitignore": "node_modules\n",
  ".github/workflows/ci.yml": `${WIRED[".github/workflows/ci.yml"]}      - run: pnpm run typecheck\n`,
  "src/index.ts": "export const value = 1;\n",
  "tsconfig.json": { extends: BASE, compilerOptions: { module: "nodenext" } },
};

function typecheck(t, files, { compiler = 7 } = {}) {
  const cwd = tempRepo(t);
  write(cwd, Object.fromEntries(Object.entries({ ...CLEAN, ...files }).filter(([, content]) => content !== null)));
  installPackage(cwd);
  if (compiler !== null) symlinkSync(COMPILERS[compiler], join(cwd, "node_modules/typescript"));
  git(cwd, "add", "-A");
  const { stdout, status } = standard(cwd, ["check", "typecheck"]);
  return { stdout, status };
}

function passes(t, files, options) {
  assert.deepEqual(Object.values(typecheck(t, files, options)), ["typecheck: OK\n", 0]);
}

function fails(t, files, ...lines) {
  const { stdout, status } = typecheck(t, files);
  assert.equal(stdout, lines.map((line) => `typecheck: ${line}\n`).join(""));
  assert.equal(status, 1);
}

function failsToRead(t, files, path, diagnostic) {
  const { stdout, status } = typecheck(t, files);
  assert.match(stdout, new RegExp(`^typecheck: ${path} config: Fix ${path} so TypeScript reads it without errors\\. ${diagnostic}`));
  assert.equal(status, 1);
}

const ROOT_SCRIPT = 'package.json scripts.typecheck: Add a typecheck script that runs the typecheck, such as "turbo run typecheck", to package.json, so CI and pre-push have one command to run.';
const PRESET = { extends: BASE };

for (const compiler of [7, 6]) {
  test(`typecheck reads each project with the repository's TypeScript ${compiler}`, (t) => {
    passes(t, {}, { compiler });
    const { stdout } = typecheck(t, { "tsconfig.json": { compilerOptions: { strict: true } } }, { compiler });
    assert.equal(stdout, `typecheck: ${EXTENDS_MISSING("tsconfig.json")}\n`);
    assert.equal(typecheck(t, { "tsconfig.json": { extends: BASE, compilerOptions: { strictNullChecks: false } } }, { compiler }).stdout, `typecheck: ${FLAG_OFF("tsconfig.json", "strictNullChecks", false)}\n`);
  });
}

test("typecheck fails closed when no TypeScript resolves from a project's folder", (t) => {
  const { stdout } = typecheck(t, {}, { compiler: null });
  assert.equal(
    stdout,
    "typecheck: tsconfig.json typescript: Add typescript to the devDependencies of the package that holds tsconfig.json and run pnpm install, so the check reads it with the repository's own compiler.\n",
  );
});

test("typecheck follows extends through a local file and reports a flag on the file that turns it off", (t) => {
  passes(t, { "tsconfig.build.json": { extends: "./tsconfig.json", compilerOptions: { outDir: "dist" } } });
  fails(t, { "tsconfig.build.json": { extends: "./tsconfig", compilerOptions: { noImplicitReturns: false } } }, FLAG_OFF("tsconfig.build.json", "noImplicitReturns", false));
});

test("typecheck reports a parent's problem once, not again on each project that extends it", (t) => {
  fails(
    t,
    {
      "tsconfig.base.json": { extends: BASE, compilerOptions: { noUncheckedIndexedAccess: false } },
      "tsconfig.json": { extends: "./tsconfig.base.json" },
      "tsconfig.test.json": { extends: "./tsconfig.base.json" },
    },
    FLAG_OFF("tsconfig.base.json", "noUncheckedIndexedAccess", false),
  );
  fails(t, { "tsconfig.json": { compilerOptions: { strict: true } }, "tsconfig.build.json": { extends: "./tsconfig.json" } }, EXTENDS_MISSING("tsconfig.json"));
});

test("typecheck judges the options a package preset leaves in effect, wherever it sits in extends", (t) => {
  const astro = (strict) => ({
    "node_modules/astro/package.json": { name: "astro", exports: { "./tsconfigs/*": "./tsconfigs/*.json" } },
    "node_modules/astro/tsconfigs/strict.json": { compilerOptions: { jsx: "preserve", exactOptionalPropertyTypes: strict } },
  });
  passes(t, { ...astro(false), "tsconfig.json": { extends: ["astro/tsconfigs/strict", BASE] } });
  passes(t, { ...astro(true), "tsconfig.json": { extends: [BASE, "astro/tsconfigs/strict"] } });
  fails(t, { ...astro(false), "tsconfig.json": { extends: [BASE, "astro/tsconfigs/strict"] } }, FLAG_OFF("tsconfig.json", "exactOptionalPropertyTypes", false));
});

test("typecheck resolves package presets exactly as TypeScript does", (t) => {
  passes(t, { "node_modules/my-preset/package.json": { name: "my-preset", tsconfig: "base.json" }, "node_modules/my-preset/base.json": PRESET, "tsconfig.json": { extends: "my-preset" } });
  passes(t, {
    "node_modules/my-preset/package.json": { name: "my-preset", exports: { "./*": "./general/*.json", "./tsconfig/*": "./specific/*.json" } },
    "node_modules/my-preset/general/tsconfig/base.json": { compilerOptions: { strict: false } },
    "node_modules/my-preset/specific/base.json": PRESET,
    "tsconfig.json": { extends: "my-preset/tsconfig/base" },
  });
  passes(t, {
    "node_modules/my-preset/package.json": { name: "my-preset" },
    "node_modules/my-preset/config/package.json": { tsconfig: "base.json" },
    "node_modules/my-preset/config/base.json": PRESET,
    "tsconfig.json": { extends: "my-preset/config" },
  });
  failsToRead(
    t,
    { "node_modules/my-preset/package.json": { name: "my-preset", exports: { "./tsconfig": "./base.conf" } }, "node_modules/my-preset/base.conf": JSON.stringify(PRESET), "tsconfig.json": { extends: "my-preset/tsconfig" } },
    "tsconfig.json",
    "TS6053: ",
  );
  failsToRead(
    t,
    {
      "node_modules/my-preset/package.json": { name: "my-preset", exports: { "./tsconfig": { import: "./import.json", require: "./missing.json" } } },
      "node_modules/my-preset/import.json": { compilerOptions: { target: "esnext" } },
      "tsconfig.json": { extends: ["my-preset/tsconfig", BASE] },
    },
    "tsconfig.json",
    "TS6053: ",
  );
});

test("typecheck fails a tsconfig that TypeScript cannot read", (t) => {
  for (const [specifier, code] of [["nonexistent-preset", 6053], ["${configDir}/configs/base.json", 6053], ["./nope.json", 5083]]) {
    failsToRead(t, { "tsconfig.json": { extends: [specifier, BASE] } }, "tsconfig.json", `TS${code}: `);
  }
  failsToRead(t, { "tsconfig.json": { extends: BASE, compilerOptions: "not an object" } }, "tsconfig.json", "TS5024: ");
  failsToRead(t, { "tsconfig.json": "{ extends: x }" }, "tsconfig.json", "TS\\d+: ");
});

test("typecheck skips a solution file and judges the projects it references", (t) => {
  const files = {
    "src/index.ts": null,
    "tsconfig.json": { files: [], references: [{ path: "apps/api" }] },
    "apps/api/src/index.ts": "export const value = 1;\n",
    "apps/api/tsconfig.json": { extends: BASE },
    "apps/api/package.json": { scripts: { typecheck: "tsc --noEmit" } },
  };
  passes(t, files);
  fails(t, { ...files, "tsconfig.json": { references: [{ path: "apps/api" }] } }, EXTENDS_MISSING("tsconfig.json"));
});

test("typecheck reads JSON with comments, trailing commas and a comment on the last line", (t) => {
  passes(t, { "tsconfig.json": `{\n  // the shared base\n  "extends": ["${BASE}",],\n  /* env */ "compilerOptions": { "target": "es2024", },\n}\n` });
  passes(t, { "tsconfig.json": `{"extends":"${BASE}"} // last comment` });
});

test("typecheck wants a typecheck script at the root and in each project's package", (t) => {
  fails(
    t,
    {
      "package.json": WIRED["package.json"],
      "apps/web/tsconfig.json": { extends: BASE },
      "apps/web/package.json": { name: "web" },
      "apps/web/src/tsconfig.json": { extends: "../tsconfig.json" },
      "apps/web/src/index.ts": "export const value = 1;\n",
    },
    ROOT_SCRIPT,
    'apps/web/package.json scripts.typecheck: Add a typecheck script that runs the typecheck, such as "tsc --noEmit", to apps/web/package.json, so the root typecheck covers apps/web/src/tsconfig.json.',
  );
});

test("typecheck does not count a typecheck script that exits at once", (t) => {
  for (const script of ["true", " exit 0 ", "echo hi", ":", ""]) {
    fails(
      t,
      {
        "package.json": { ...CLEAN["package.json"], scripts: { ...CLEAN["package.json"].scripts, typecheck: script } },
        "apps/web/tsconfig.json": { extends: BASE },
        "apps/web/package.json": { name: "web", scripts: { typecheck: script } },
        "apps/web/src/index.ts": "export const value = 1;\n",
      },
      ROOT_SCRIPT,
      'apps/web/package.json scripts.typecheck: Add a typecheck script that runs the typecheck, such as "tsc --noEmit", to apps/web/package.json, so the root typecheck covers apps/web/tsconfig.json.',
    );
  }
});

test("typecheck wants a typecheck script for a package whose only project is a named tsconfig", (t) => {
  fails(
    t,
    { "packages/tools/package.json": { name: "tools" }, "packages/tools/tsconfig.editor.json": { extends: BASE, include: ["../../src"] } },
    'packages/tools/package.json scripts.typecheck: Add a typecheck script that runs the typecheck, such as "tsc --noEmit -p tsconfig.editor.json", to packages/tools/package.json, so the root typecheck covers packages/tools/tsconfig.editor.json.',
  );
});

test("typecheck wants a pre-push line that is exactly the typecheck command", (t) => {
  const hook = (line) => ({ ".standard/config.json": { hooks: { "pre-push": [line] } } });
  passes(t, hook("  pnpm run typecheck "));
  for (const line of ["pnpm lint && pnpm run typecheck", "exit 0 && pnpm typecheck", "exec true && pnpm typecheck", "pnpm run typecheck:foo", 'echo "pnpm typecheck"', "pnpm typecheck || true", "pnpm typecheck; true"]) {
    fails(t, hook(line), 'hooks.pre-push: Add the line "pnpm typecheck" to hooks.pre-push in .standard/config.json, so a push that fails typecheck stops before CI.');
  }
});

test("typecheck wants a Check job step whose run is exactly the typecheck command", (t) => {
  const ci = (step) => ({ ".github/workflows/ci.yml": `${WIRED[".github/workflows/ci.yml"]}${step}` });
  const miss = 'ci: Add a step to the Check job whose run is "pnpm typecheck", with no continue-on-error, so a pull request that fails typecheck cannot merge.';
  passes(t, ci("      - if: ${{ !cancelled() }}\n        run: |\n          pnpm typecheck\n"));
  for (const step of [
    "",
    "      - run: exit 0 && pnpm typecheck\n",
    "      - run: pnpm lint && pnpm typecheck\n",
    "      - run: |\n          run-parallel.sh \\\n            'pnpm run typecheck'\n",
    '      - run: echo "pnpm typecheck"\n',
    "      - run: pnpm typecheck || true\n",
    "      - run: pnpm typecheck\n        shell: bash {0}\n",
    "      - run: pnpm typecheck\n        continue-on-error: true\n",
  ]) {
    fails(t, ci(step), miss);
  }
});

test("typecheck does not count a Check job step whose if is constant false", (t) => {
  const miss = 'ci: Add a step to the Check job whose run is "pnpm typecheck", with no continue-on-error, so a pull request that fails typecheck cannot merge.';
  for (const condition of ["false", "${{ false }}", "''"]) {
    fails(t, { ".github/workflows/ci.yml": `${WIRED[".github/workflows/ci.yml"]}      - if: ${condition}\n        run: pnpm typecheck\n` }, miss);
  }
});

test("typecheck leaves a repository without a Check job to the ci probe", (t) => {
  passes(t, { ".github/workflows/ci.yml": null });
});

test("typecheck keeps no baseline, pending holds it off, and it skips a repository without a tsconfig", (t) => {
  const { stdout, status } = typecheck(t, { "tsconfig.json": {}, ".standard/config.json": { pending: ["typecheck"] } });
  assert.deepEqual([stdout, status], ["typecheck: pending in .standard/config.json, so it did not run\n", 0]);
  assert.equal(typecheck(t, { "tsconfig.json": null }).stdout, "typecheck: skipped, git tracks no tsconfig.json\n");
});
