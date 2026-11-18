import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registry } from "../src/registry.mjs";
import plugin from "../src/oxlint/index.mjs";
import manifest from "../package.json" with { type: "json" };
import oxlint from "../config/oxlint.json" with { type: "json" };

test("the release snapshots every default CLI and plugin rule", () => {
  const actual = { version: manifest.version, checks: registry.map(({ name }) => name), plugin: Object.keys(plugin.rules).map((name) => [name, oxlint.rules[`standard/${name}`]]) };
  assert.deepEqual(actual, JSON.parse(readFileSync(new URL("./fixtures/defaults.json", import.meta.url))));
});
