import assert from "node:assert/strict";
import { test } from "node:test";

import plugin from "../src/oxlint/rules.mjs";
import { standard, tempRepo } from "./helpers.mjs";

test("standard explain lists and explains every plugin rule", (t) => {
  const cwd = tempRepo(t, {});
  const all = standard(cwd, ["explain"]);
  for (const name of Object.keys(plugin.rules)) assert.match(all.stdout, new RegExp(`^standard/${name} `, "m"));
  const one = standard(cwd, ["explain", "standard/zod"]);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /^standard\/zod\n {2}Enforces: .+\n {2}Fix: .+\n {2}Runs in: oxlint, through @mapringg\/standard\/oxlint\n/);
});
