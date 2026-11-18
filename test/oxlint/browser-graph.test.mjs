import assert from "node:assert/strict";
import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tempDir, write } from "../helpers.mjs";
import { shipsToBrowser } from "../../src/oxlint/browser.mjs";

test("the browser graph follows template imports and rebuilds after a file changes", async (t) => {
  const root = tempDir(t, "browser-graph");
  mkdirSync(join(root, ".git"));
  write(root, { "package.json": { type: "module" }, "src/view.tsx": '"use client";\nexport const lazy = () => import(`./lazy`);\n', "src/lazy.ts": "export const lazy = 1;\n", "src/shared.ts": "export const shared = 1;\n", "src/panel.tsx": 'import { shared } from "./shared";\nexport const panel = shared;\n' });
  const context = (/** @type {string} */ file) => ({ cwd: root, filename: join(root, file) });
  assert.equal(shipsToBrowser(context("src/lazy.ts")), true);
  assert.equal(shipsToBrowser(context("src/shared.ts")), false);
  write(root, { "src/panel.tsx": '"use client";\nimport { shared } from "./shared";\nexport const panel = shared;\n' });
  const later = new Date(Date.now() + 5000);
  utimesSync(join(root, "src/panel.tsx"), later, later);
  await new Promise((done) => setTimeout(done, 1100));
  assert.equal(shipsToBrowser(context("src/shared.ts")), true);
});
